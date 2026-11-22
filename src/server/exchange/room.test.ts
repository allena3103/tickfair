/**
 * Integration test of the real ExchangeRoom Durable Object class: requests go
 * through its own `fetch` entry (`POST /exchange/order|shock`), batches run
 * from `alarm()`, market data goes to sockets, and mirror writes go to a fake
 * RecordRoom stub. Only the platform pieces are faked: DO storage (SQLite via
 * node:sqlite), the clock, sockets, and the RecordRoom fetch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExchangeServerMsg } from '../../shared/contracts'
import { memoryDb } from './test-db'

// BaseRoom's constructor registers a ping/pong auto-response; workerd provides this class.
;(globalThis as Record<string, unknown>).WebSocketRequestResponsePair ??= class {
  constructor(
    public request: string,
    public response: string,
  ) {}
}
const { ExchangeRoom } = await import('../exchange-room')

const T0 = 1_800_000_000_000
const LIVE_MS = 60_000
const BREAK_MS = 10_000

interface FakeWs {
  readyState: number
  sent: ExchangeServerMsg[]
  send(s: string): void
}

function fakeWs(): FakeWs {
  return {
    readyState: 1,
    sent: [],
    send(s: string) {
      if (this.readyState !== 1) throw new Error('closed')
      this.sent.push(JSON.parse(s))
    },
  }
}

interface Write {
  actor: string | null
  collection: string
  recordId: string
  data: Record<string, unknown>
}

function setup() {
  const db = memoryDb()
  const sockets: FakeWs[] = []
  let alarm: number | null = null
  const writes: Write[] = []
  const state = {
    storage: {
      sql: db.sql,
      transactionSync: <T>(fn: () => T) => db.txn(fn),
      getAlarm: async () => alarm,
      setAlarm: async (t: number | Date) => {
        alarm = typeof t === 'number' ? t : t.getTime()
      },
      deleteAlarm: async () => {
        alarm = null
      },
    },
    setWebSocketAutoResponse: () => {},
    getWebSockets: () => sockets,
  }
  const env = {
    DEEPSPACE_APP_ID: 'app_test',
    OWNER_USER_ID: 'owner-id',
    EXCHANGE_ROUND_LIVE_MS: String(LIVE_MS),
    EXCHANGE_ROUND_BREAK_MS: String(BREAK_MS),
    RECORD_ROOMS: {
      idFromName: (n: string) => n,
      get: () => ({
        fetch: async (req: Request) => {
          const body = (await req.json()) as { tool: string; params: { collection: string; recordId: string; data: Record<string, unknown> } }
          expect(body.tool).toBe('records.create')
          expect(req.headers.get('X-App-Action')).toBe('true')
          writes.push({ actor: req.headers.get('X-User-Id'), ...body.params })
          return Response.json({ success: true, data: {} })
        },
      }),
    },
  }
  const room = new ExchangeRoom(state as any, env as any)
  const r = room as any

  async function connect(): Promise<FakeWs> {
    const ws = fakeWs()
    sockets.push(ws)
    await r.onConnect(ws, { userId: 'anon-1', userName: '', userEmail: '' })
    return ws
  }
  async function post(path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    const res = await room.fetch(
      new Request(`https://exchange.internal${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    )
    const text = await res.text()
    return { status: res.status, json: res.status === 404 ? {} : (JSON.parse(text) as Record<string, unknown>) }
  }
  /** Fire the armed alarm at its time. */
  async function fireAlarm(): Promise<void> {
    if (alarm === null) throw new Error('no alarm armed')
    vi.setSystemTime(Math.max(alarm, Date.now()))
    alarm = null // the runtime clears an alarm when it fires
    await room.alarm()
  }
  return { room, db, sockets, writes, connect, post, fireAlarm, getAlarm: () => alarm }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
})
afterEach(() => {
  vi.useRealTimers()
})

const batches = (ws: FakeWs) => ws.sent.filter((m): m is Extract<ExchangeServerMsg, { type: 'ex.batch' }> => m.type === 'ex.batch')

describe('ExchangeRoom (DO integration)', () => {
  it('snapshot on connect, a buy fills, mirrors go out as the right identity, and a shock moves the price', async () => {
    const h = setup()
    const ws = await h.connect()
    // The first round opens on this connect: its ex.phase goes out, then the snapshot.
    expect(ws.sent.map((m) => m.type)).toEqual(['ex.phase', 'ex.snapshot'])
    expect(ws.sent[1]).toMatchObject({ type: 'ex.snapshot', phase: 'live', batchId: 1, nextBatchAt: T0 + 1_000 })
    expect(h.getAlarm()).toBe(T0 + 1_000)

    const order = await h.post('/exchange/order', {
      userId: 'trader-1',
      displayName: 'Trader One',
      params: { ticker: 'ORBT', side: 'buy', type: 'market', qty: 5 },
    })
    expect(order.status).toBe(200)
    expect(order.json).toMatchObject({ ok: true, data: { batchId: 1 } })
    const orderId = (order.json.data as { orderId: string }).orderId

    for (let i = 0; i < 3; i++) await h.fireAlarm()
    expect(batches(ws).map((b) => b.batchId)).toEqual([2, 3, 4])
    const fill = h.writes.find((w) => w.collection === 'fills')
    expect(fill).toMatchObject({ actor: 'trader-1', recordId: `${orderId}:1`, data: { userId: 'trader-1', ticker: 'ORBT' } })
    expect(h.writes.find((w) => w.collection === 'orders' && w.recordId === orderId)?.actor).toBe('trader-1')
    const pf = h.writes.filter((w) => w.collection === 'portfolios').at(-1)!
    expect(pf.actor).toBe('owner-id')
    expect((pf.data.holdings as Record<string, number>).ORBT).toBeGreaterThan(0)
    expect(h.writes.some((w) => w.collection === 'tape' && w.actor === 'owner-id')).toBe(true)
    expect(h.writes.some((w) => w.collection === 'rounds' && w.data.status === 'live')).toBe(true)
    // Bots never get order or fill mirrors.
    expect(h.writes.filter((w) => w.collection === 'orders' || w.collection === 'fills').every((w) => w.actor === 'trader-1')).toBe(true)

    // Shock: fixed +800 bps on CURA over 15 batches.
    expect((await h.post('/exchange/shock', { newsId: 'n-1', ticker: 'CURA', deltaBps: 'big', rampBatches: 15 })).status).toBe(400)
    const before = batches(ws).at(-1)!.last.CURA
    const shock = await h.post('/exchange/shock', { newsId: 'n-1', ticker: 'CURA', deltaBps: 800, rampBatches: 15 })
    expect(shock).toEqual({ status: 200, json: { ok: true } })
    const series: number[] = []
    for (let i = 0; i < 45; i++) {
      await h.fireAlarm()
      series.push(batches(ws).at(-1)!.last.CURA)
    }
    const after = series.at(-1)!
    const hidden = h.db.sql.exec(`SELECT valueCents, rampLeft FROM fundamentals WHERE ticker = 'CURA'`).toArray()[0] as { valueCents: number; rampLeft: number }
    console.log(`[room.test] CURA last before shock ${before}, after 45 batches ${after} (${(((after - before) / before) * 100).toFixed(2)}%), hidden value ${hidden.valueCents}: ${series.join(' ')}`)
    // The hidden value finished its ramp near +8% (plus a small random walk)...
    expect(hidden.rampLeft).toBe(0)
    expect(hidden.valueCents).toBeGreaterThan(before * 1.06)
    // ...and the traded price followed it, within the band, with no jump past it.
    expect(after).toBeGreaterThan(before * 1.04)
    expect(Math.max(...series)).toBeLessThan(before * 1.15)

    // The impact size never reaches clients.
    const wire = JSON.stringify(ws.sent)
    expect(wire).not.toMatch(/valueCents|targetCents|deltaBps|rampLeft/)
  })

  it('rolls the round over on schedule and never leaves a rounds record live once idle', async () => {
    const h = setup()
    const ws = await h.connect()
    const roundId = (ws.sent[1] as { roundId: string }).roundId
    while (Date.now() < T0 + LIVE_MS) await h.fireAlarm()
    expect(ws.sent.find((m) => m.type === 'ex.phase' && m.phase === 'break')).toMatchObject({ roundId, phaseEndsAt: T0 + LIVE_MS + BREAK_MS })
    while (Date.now() < T0 + LIVE_MS + BREAK_MS) await h.fireAlarm()
    const live = ws.sent.filter((m) => m.type === 'ex.phase' && m.phase === 'live')
    expect(live).toHaveLength(2)
    expect((live[1] as { roundId: string }).roundId).not.toBe(roundId)
    const done = h.writes.filter((w) => w.collection === 'rounds' && w.recordId === roundId).at(-1)!
    expect(done.data).toMatchObject({ status: 'done', standings: [], winnerId: '' })

    // Everyone leaves. The alarm keeps the clock until the idle pause, then
    // stops, but only after any live round has been closed.
    ws.readyState = 3
    let n = 0
    while (h.getAlarm() !== null && n++ < 2_000) await h.fireAlarm()
    expect(h.getAlarm()).toBeNull()
    const last = new Map<string, unknown>()
    for (const w of h.writes.filter((w) => w.collection === 'rounds')) last.set(w.recordId, w.data.status)
    expect([...last.values()].every((s) => s === 'done')).toBe(true)

    // The next visitor starts a fresh round.
    await h.connect()
    expect(h.getAlarm()).not.toBeNull()
  })

  it('unknown paths and GETs are 404', async () => {
    const h = setup()
    expect((await h.room.fetch(new Request('https://exchange.internal/exchange/order'))).status).toBe(404)
    expect((await h.post('/exchange/nope', {})).status).toBe(404)
  })
})
