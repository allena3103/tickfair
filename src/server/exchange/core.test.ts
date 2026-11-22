import { describe, expect, it } from 'vitest'
import {
  MAX_ORDERS_PER_BATCH,
  START_CASH_CENTS,
  TICKERS,
  type ExchangeServerMsg,
  type FillRecord,
  type OrderRecord,
  type PortfolioRecord,
  type RoundRecord,
  type TapeRecord,
} from '../../shared/contracts'
import { priceBand } from '../../engine/core'
import { INITIAL_PRICES, MM_BOT_ID, NOISE_BOT_ID, createRng } from '../../engine/market'
import { IDLE_PAUSE_MS } from './config'
import { ExchangeCore } from './core'
import { flushMirror, pendingCount } from './mirror'
import { rows, type SqlLike } from './sql'
import { loadAccount, loadMarket, totals } from './store'
import { memoryDb } from './test-db'

const T0 = 1_800_000_000_000
const LIVE_MS = 60_000
const BREAK_MS = 10_000

function setup(durations = { liveMs: LIVE_MS, breakMs: BREAK_MS }) {
  const { sql, txn } = memoryDb()
  let n = 0
  const logs: string[] = []
  const errors: string[] = []
  const core = new ExchangeCore({
    sql,
    txn,
    durations,
    newId: () => `id${String(++n).padStart(8, '0')}`,
    log: (l) => logs.push(l),
    logError: (l) => errors.push(l),
  })
  return { core, sql, txn, logs, errors }
}

type Core = ExchangeCore

function place(core: Core, now: number, userId: string, params: Record<string, unknown>) {
  return core.placeOrder(now, { userId, displayName: `Name ${userId}`, params })
}

/** Run k batches at their scheduled times; returns the time of the last one and all messages. */
function runBatches(core: Core, k: number): { now: number; msgs: ExchangeServerMsg[] } {
  const msgs: ExchangeServerMsg[] = []
  let now = 0
  for (let i = 0; i < k; i++) {
    now = core.meta()!.nextBatchAt
    msgs.push(...core.tick(now, false))
  }
  return { now, msgs }
}

function queued<T>(sql: SqlLike, collection: string): { recordId: string; actor: string; data: T }[] {
  return rows<{ recordId: string; actor: string; data: string }>(
    sql,
    `SELECT recordId, actor, data FROM mirror WHERE collection = ? ORDER BY seq`,
    collection,
  ).map((r) => ({ recordId: r.recordId, actor: r.actor, data: JSON.parse(r.data) as T }))
}

function order(sql: SqlLike, orderId: string) {
  return rows<{ status: string; remaining: number; filledQty: number; limitCents: number; type: string }>(
    sql,
    `SELECT * FROM book WHERE orderId = ?`,
    orderId,
  )[0]
}

describe('round start', () => {
  it('opens a live round on first wake, seeds bots, quotes, and queues the live rounds record', () => {
    const { core, sql, errors } = setup()
    const msgs = core.wake(T0)
    const m = core.meta()!
    expect(m.phase).toBe('live')
    expect(m.batchId).toBe(1)
    expect(m.phaseEndsAt).toBe(T0 + LIVE_MS)
    expect(m.nextBatchAt).toBe(T0 + 1_000)
    expect(msgs).toEqual([{ type: 'ex.phase', roundId: m.roundId, phase: 'live', phaseEndsAt: T0 + LIVE_MS }])

    const mm = loadAccount(sql, MM_BOT_ID)!
    const noise = loadAccount(sql, NOISE_BOT_ID)!
    for (const t of TICKERS) {
      expect(mm.holdings[t].qty).toBeGreaterThan(0)
      expect(noise.holdings[t].qty).toBeGreaterThan(0)
    }
    // The maker quoted both sides into batch 1.
    const botOrders = rows<{ userId: string; batchId: number }>(sql, `SELECT userId, batchId FROM book`)
    expect(botOrders.filter((o) => o.userId === MM_BOT_ID).length).toBe(6)
    expect(botOrders.every((o) => o.batchId === 1)).toBe(true)

    const rounds = queued<RoundRecord>(sql, 'rounds')
    expect(rounds).toEqual([
      { recordId: m.roundId, actor: '', data: { startsAt: T0, endsAt: T0 + LIVE_MS, status: 'live', standings: [], winnerId: '' } },
    ])
    expect(queued(sql, 'tickers').map((r) => r.recordId).sort()).toEqual([...TICKERS].sort())
    expect(queued(sql, 'orders')).toEqual([]) // bots get no order mirrors
    expect(errors).toEqual([])
  })

  it('a second wake does not start another round', () => {
    const { core } = setup()
    core.wake(T0)
    const id = core.meta()!.roundId
    expect(core.wake(T0 + 500)).toEqual([])
    expect(core.meta()!.roundId).toBe(id)
  })
})

describe('intake', () => {
  it('enrolls on first order, reserves cash, and acks with orderId and the open batch', () => {
    const { core, sql } = setup()
    core.wake(T0)
    const res = place(core, T0 + 10, 'userA', { ticker: 'ORBT', side: 'buy', type: 'limit', qty: 10, limitCents: 11_000 })
    expect(res).toEqual({ ok: true, data: { orderId: expect.stringMatching(/^o-/), batchId: 1 } })
    const a = loadAccount(sql, 'userA')!
    expect(a.cashCents).toBe(START_CASH_CENTS - 110_000)
    expect(a.reservedCents).toBe(110_000)

    const orders = queued<OrderRecord>(sql, 'orders')
    expect(orders).toHaveLength(1)
    expect(orders[0].actor).toBe('userA') // written as the trader so 'own' reads work
    expect(orders[0].data).toMatchObject({ userId: 'userA', status: 'open', qty: 10, limitCents: 11_000, filledQty: 0 })
    const pf = queued<PortfolioRecord>(sql, 'portfolios')
    expect(pf).toHaveLength(1)
    expect(pf[0].data).toMatchObject({ userId: 'userA', displayName: 'Name userA', cashCents: START_CASH_CENTS })
  })

  it('stores a market order with the band-edge limit it reserved at', () => {
    const { core, sql } = setup()
    core.wake(T0)
    const res = place(core, T0, 'userA', { ticker: 'CURA', side: 'buy', type: 'market', qty: 3 })
    if (!res.ok) throw new Error(res.code)
    const o = order(sql, res.data.orderId)
    expect(o.type).toBe('market')
    expect(o.limitCents).toBe(priceBand(INITIAL_PRICES.CURA).hi)
  })

  it.each([
    [{ ticker: 'AAPL', side: 'buy', type: 'limit', qty: 1, limitCents: 12_000 }, 'invalid_ticker'],
    [{ ticker: 'ORBT', side: 'hold', type: 'limit', qty: 1, limitCents: 12_000 }, 'invalid_side'],
    [{ ticker: 'ORBT', side: 'buy', type: 'stop', qty: 1, limitCents: 12_000 }, 'invalid_type'],
    [{ ticker: 'ORBT', side: 'buy', type: 'limit', qty: 0, limitCents: 12_000 }, 'invalid_qty'],
    [{ ticker: 'ORBT', side: 'buy', type: 'limit', qty: 1 }, 'invalid_price'],
    [{ ticker: 'ORBT', side: 'buy', type: 'limit', qty: 1, limitCents: 20_000 }, 'outside_band'],
    [{ ticker: 'ORBT', side: 'buy', type: 'limit', qty: 900, limitCents: 12_000 }, 'insufficient_cash'],
    [{ ticker: 'ORBT', side: 'sell', type: 'limit', qty: 1, limitCents: 12_000 }, 'insufficient_shares'],
  ])('rejects %j with %s and reserves nothing', (params, code) => {
    const { core, sql } = setup()
    core.wake(T0)
    expect(place(core, T0, 'userA', params)).toEqual({ ok: false, code })
    expect(rows(sql, `SELECT * FROM book WHERE userId = 'userA'`)).toEqual([])
    const a = loadAccount(sql, 'userA')
    if (a) expect(a.reservedCents).toBe(0)
  })

  it('refuses bot identities, missing users, and orders when no round is live', () => {
    const { core } = setup()
    const ok = { ticker: 'ORBT', side: 'buy', type: 'limit', qty: 1, limitCents: 12_000 }
    expect(place(core, T0, 'userA', ok)).toEqual({ ok: false, code: 'round_closed' })
    core.wake(T0)
    expect(place(core, T0, MM_BOT_ID, ok)).toEqual({ ok: false, code: 'forbidden' })
    expect(core.placeOrder(T0, { params: ok })).toEqual({ ok: false, code: 'forbidden' })
    expect(core.placeOrder(T0, null)).toEqual({ ok: false, code: 'forbidden' })
    expect(core.placeOrder(T0, { userId: 'userA', params: 'x' })).toEqual({ ok: false, code: 'invalid_ticker' })
  })

  it(`rate-limits a trader to ${MAX_ORDERS_PER_BATCH} orders per batch`, () => {
    const { core } = setup()
    core.wake(T0)
    for (let i = 0; i < MAX_ORDERS_PER_BATCH; i++) {
      const r = place(core, T0, 'userA', { ticker: 'VOLT', side: 'buy', type: 'limit', qty: 1, limitCents: 7_500 + i })
      expect(r.ok).toBe(true)
    }
    expect(place(core, T0, 'userA', { ticker: 'VOLT', side: 'buy', type: 'limit', qty: 1, limitCents: 7_400 })).toEqual({
      ok: false,
      code: 'rate_limited',
    })
    // Another trader is unaffected, and the cap resets next batch.
    expect(place(core, T0, 'userB', { ticker: 'VOLT', side: 'buy', type: 'limit', qty: 1, limitCents: 7_400 }).ok).toBe(true)
    runBatches(core, 1)
    expect(place(core, core.meta()!.nextBatchAt - 500, 'userA', { ticker: 'VOLT', side: 'buy', type: 'limit', qty: 1, limitCents: 7_300 }).ok).toBe(true)
  })
})

describe('cancel', () => {
  it('releases the reservation; other users get not_owner; a second cancel is already_final', () => {
    const { core, sql } = setup()
    core.wake(T0)
    const res = place(core, T0, 'userA', { ticker: 'ORBT', side: 'buy', type: 'limit', qty: 5, limitCents: 11_000 })
    if (!res.ok) throw new Error(res.code)
    const { orderId } = res.data
    expect(core.cancelOrder(T0, { userId: 'userB', orderId })).toEqual({ ok: false, code: 'not_owner' })
    expect(core.cancelOrder(T0, { userId: 'userA', orderId: 'o-nope' })).toEqual({ ok: false, code: 'not_found' })
    expect(core.cancelOrder(T0, { userId: 'userA', orderId })).toEqual({ ok: true })
    const a = loadAccount(sql, 'userA')!
    expect(a.cashCents).toBe(START_CASH_CENTS)
    expect(a.reservedCents).toBe(0)
    expect(order(sql, orderId).status).toBe('cancelled')
    expect(core.cancelOrder(T0, { userId: 'userA', orderId })).toEqual({ ok: false, code: 'already_final' })
    expect(queued<OrderRecord>(sql, 'orders')[0].data.status).toBe('cancelled') // coalesced into one row
  })
})

describe('batch', () => {
  it('fills a marketable buy against the bots, mirrors fills/portfolio/tape, and keeps invariants', () => {
    const { core, sql, errors } = setup()
    core.wake(T0)
    const res = place(core, T0 + 1, 'userA', { ticker: 'ORBT', side: 'buy', type: 'limit', qty: 5, limitCents: priceBand(12_000).hi })
    if (!res.ok) throw new Error(res.code)
    const before = totals(sql)
    const { msgs } = runBatches(core, 1)

    const o = order(sql, res.data.orderId)
    expect(o.filledQty).toBeGreaterThan(0)
    const fills = queued<FillRecord>(sql, 'fills')
    expect(fills.length).toBeGreaterThan(0)
    expect(fills[0].actor).toBe('userA')
    expect(fills[0].recordId).toBe(`${res.data.orderId}:1`)
    const tape = queued<TapeRecord>(sql, 'tape').find((r) => r.data.ticker === 'ORBT')!
    expect(tape.recordId).toBe(`${core.meta()!.roundId}:ORBT:1`)
    expect(fills.every((f) => f.data.priceCents === tape.data.clearCents)).toBe(true)
    const a = loadAccount(sql, 'userA')!
    expect(a.holdings.ORBT.qty).toBe(o.filledQty)
    const pf = queued<PortfolioRecord>(sql, 'portfolios')[0].data
    expect(pf.holdings.ORBT).toBe(o.filledQty)
    expect(pf.cashCents).toBe(a.cashCents + a.reservedCents)

    const batch = msgs.find((m) => m.type === 'ex.batch')
    if (batch?.type !== 'ex.batch') throw new Error('no ex.batch')
    expect(batch.batchId).toBe(2)
    expect(batch.last.ORBT).toBe(tape.data.clearCents)
    expect(batch.prints.find((p) => p.ticker === 'ORBT')).toMatchObject({ batchId: 1, clearCents: tape.data.clearCents })
    for (const t of TICKERS) {
      expect(batch.depth[t].bids.length).toBeLessThanOrEqual(10)
      for (const lvl of [...batch.depth[t].bids, ...batch.depth[t].asks]) expect(lvl).toHaveLength(2)
    }
    expect(totals(sql)).toEqual(before)
    expect(errors).toEqual([])
  })

  it('two players crossing in the same batch both fill at the one clearing price', () => {
    const { core, sql } = setup()
    core.wake(T0)
    // B first buys shares so it can sell (long-only).
    place(core, T0, 'userB', { ticker: 'VOLT', side: 'buy', type: 'market', qty: 20 })
    runBatches(core, 2)
    const bShares = loadAccount(sql, 'userB')!.holdings.VOLT.qty
    expect(bShares).toBeGreaterThan(0)

    const now = core.meta()!.nextBatchAt - 500
    const last = loadMarket(sql).VOLT.lastCents
    const { lo, hi } = priceBand(last)
    const a = place(core, now, 'userA', { ticker: 'VOLT', side: 'buy', type: 'limit', qty: 3, limitCents: hi })
    const b = place(core, now, 'userB', { ticker: 'VOLT', side: 'sell', type: 'limit', qty: 3, limitCents: lo })
    if (!a.ok || !b.ok) throw new Error('rejected')
    expect(a.data.batchId).toBe(b.data.batchId)
    runBatches(core, 1)

    const batchId = a.data.batchId
    const fills = queued<FillRecord>(sql, 'fills').filter((f) => f.data.batchId === batchId)
    const prices = new Set(fills.map((f) => f.data.priceCents))
    expect(prices.size).toBe(1)
    expect(fills.some((f) => f.data.userId === 'userA')).toBe(true)
    expect(fills.some((f) => f.data.userId === 'userB')).toBe(true)
  })

  it('updates the maker inventory from its fills and keeps bot orders within the band', () => {
    const { core, sql } = setup()
    core.wake(T0)
    place(core, T0, 'userA', { ticker: 'ORBT', side: 'buy', type: 'market', qty: 40 })
    runBatches(core, 1)
    const state = JSON.parse(rows<{ state: string }>(sql, `SELECT state FROM bots WHERE botId = ?`, MM_BOT_ID)[0].state)
    const mm = loadAccount(sql, MM_BOT_ID)!
    // inventory is signed shares relative to the seeded position.
    expect(state.inventory.ORBT).toBe(mm.holdings.ORBT.qty - 20_000)
    const market = loadMarket(sql)
    for (const o of rows<{ ticker: 'ORBT'; limitCents: number }>(sql, `SELECT ticker, limitCents FROM book WHERE userId LIKE 'bot:%'`)) {
      const { lo, hi } = priceBand(market[o.ticker].lastCents)
      expect(o.limitCents).toBeGreaterThanOrEqual(lo)
      expect(o.limitCents).toBeLessThanOrEqual(hi)
    }
  })

  it('does not clear early, and keeps the clock without drift', () => {
    const { core } = setup()
    core.wake(T0)
    expect(core.tick(T0 + 500, false)).toEqual([])
    expect(core.meta()!.batchId).toBe(1)
    core.tick(T0 + 1_010, false)
    expect(core.meta()!.batchId).toBe(2)
    expect(core.meta()!.nextBatchAt).toBe(T0 + 2_000)
  })

  it('runs 300 batches of random play with no invariant failure and conserved totals', () => {
    const { core, sql, errors } = setup({ liveMs: 10 * 60_000, breakMs: BREAK_MS })
    core.wake(T0)
    const seeded = totals(sql)
    const rng = createRng('random-play')
    const rand = (k: number) => rng.int(0, k - 1)
    for (let i = 0; i < 300; i++) {
      const now = core.meta()!.nextBatchAt - 300
      for (const u of ['u1', 'u2', 'u3']) {
        const t = TICKERS[rand(3)]
        const last = loadMarket(sql)[t].lastCents
        const { lo, hi } = priceBand(last)
        if (rand(4) === 0) {
          const open = rows<{ orderId: string }>(sql, `SELECT orderId FROM book WHERE userId = ? AND status IN ('open','partial')`, u)
          if (open.length) core.cancelOrder(now, { userId: u, orderId: open[rand(open.length)].orderId })
        } else {
          place(core, now, u, { ticker: t, side: rand(2) ? 'buy' : 'sell', type: rand(3) ? 'limit' : 'market', qty: 1 + rand(30), limitCents: lo + rand(hi - lo + 1) })
        }
      }
      runBatches(core, 1)
    }
    expect(errors).toEqual([])
    expect(core.meta()!.halted).toBe(0)
    // Only enrollment adds money: three players with START_CASH_CENTS each.
    expect(totals(sql)).toEqual({ ...seeded, cash: seeded.cash + 3 * START_CASH_CENTS })
    expect(rows(sql, `SELECT * FROM batches`).length).toBeGreaterThan(100)
    const humanFills = queued(sql, 'fills').length
    expect(humanFills).toBeGreaterThan(50)
  }, 30_000)
})

describe('shock', () => {
  it('moves the hidden value toward the target over the ramp; same newsId twice applies once', () => {
    const { core, sql } = setup({ liveMs: 10 * 60_000, breakMs: BREAK_MS })
    core.wake(T0)
    const v0 = loadMarket(sql).CURA.valueCents
    const req = { newsId: 'news_1', ticker: 'CURA', deltaBps: 800, rampBatches: 15 }
    expect(core.shock(T0, req)).toEqual({ ok: true })
    expect(core.shock(T0, req)).toEqual({ ok: true })
    const target = loadMarket(sql).CURA.targetCents
    expect(target).toBeGreaterThan(v0 * 1.07)
    expect(target).toBeLessThan(v0 * 1.09)
    expect(loadMarket(sql).CURA.valueCents).toBe(v0) // nothing moves before the next batch
    runBatches(core, 15)
    const after = loadMarket(sql).CURA
    expect(after.rampLeft).toBe(0)
    expect(after.valueCents).toBeGreaterThan(v0 * 1.06)
  })

  it('rejects malformed shocks and returns round_closed during the break', () => {
    const { core } = setup()
    core.wake(T0)
    expect(core.shock(T0, { newsId: 'n', ticker: 'AAPL', deltaBps: 100, rampBatches: 10 })).toEqual({ ok: false, code: 'bad_request' })
    expect(core.shock(T0, { newsId: 'n', ticker: 'ORBT', deltaBps: 1.5, rampBatches: 10 })).toEqual({ ok: false, code: 'bad_request' })
    expect(core.shock(T0, { newsId: 'n', ticker: 'ORBT', deltaBps: 100, rampBatches: 0 })).toEqual({ ok: false, code: 'bad_request' })
    core.tick(T0 + LIVE_MS, false)
    expect(core.meta()!.phase).toBe('break')
    expect(core.shock(T0 + LIVE_MS + 1, { newsId: 'n2', ticker: 'ORBT', deltaBps: 100, rampBatches: 10 })).toEqual({
      ok: false,
      code: 'round_closed',
    })
  })
})

describe('round end', () => {
  it('cancels orders, releases reservations, ranks humans only, and opens the next round after the break', () => {
    const { core, sql, errors } = setup()
    core.wake(T0)
    place(core, T0, 'userA', { ticker: 'ORBT', side: 'buy', type: 'market', qty: 10 })
    runBatches(core, 1)
    const resting = place(core, T0 + 1_500, 'userB', { ticker: 'VOLT', side: 'buy', type: 'limit', qty: 10, limitCents: 7_300 })
    if (!resting.ok) throw new Error(resting.code)
    const roundId = core.meta()!.roundId

    const msgs = core.tick(T0 + LIVE_MS, false)
    expect(msgs).toEqual([{ type: 'ex.phase', roundId, phase: 'break', phaseEndsAt: T0 + LIVE_MS + BREAK_MS }])
    expect(order(sql, resting.data.orderId).status).toBe('cancelled')
    expect(rows(sql, `SELECT * FROM book WHERE status IN ('open','partial')`)).toEqual([])
    expect(loadAccount(sql, 'userB')!.reservedCents).toBe(0)

    const done = queued<RoundRecord>(sql, 'rounds').find((r) => r.recordId === roundId)!.data
    expect(done.status).toBe('done')
    expect(done.standings.map((s) => s.userId).sort()).toEqual(['userA', 'userB'])
    expect(done.standings.every((s) => !s.userId.startsWith('bot:'))).toBe(true)
    expect(done.winnerId).toBe(done.standings[0].userId)
    expect(place(core, T0 + LIVE_MS + 1, 'userA', { ticker: 'ORBT', side: 'buy', type: 'market', qty: 1 })).toEqual({
      ok: false,
      code: 'round_closed',
    })

    const next = core.tick(T0 + LIVE_MS + BREAK_MS, false)
    expect(next[0]).toMatchObject({ type: 'ex.phase', phase: 'live' })
    expect(core.meta()!.roundId).not.toBe(roundId)
    expect(loadAccount(sql, 'userA')).toBeNull() // players re-enroll lazily
    expect(loadMarket(sql).ORBT.lastCents).toBe(INITIAL_PRICES.ORBT)
    expect(errors).toEqual([])
  })

  it('a round with no players ends with no winner', () => {
    const { core, sql } = setup()
    core.wake(T0)
    const roundId = core.meta()!.roundId
    core.tick(T0 + LIVE_MS, false)
    const done = queued<RoundRecord>(sql, 'rounds').find((r) => r.recordId === roundId)!.data
    expect(done).toMatchObject({ status: 'done', standings: [], winnerId: '' })
  })
})

describe('idle pause and resume', () => {
  it('goes idle after 5 minutes without sockets or orders, and an idle tick runs no batch', () => {
    const { core } = setup({ liveMs: 15 * 60_000, breakMs: BREAK_MS })
    core.wake(T0)
    expect(core.isIdle(T0 + IDLE_PAUSE_MS - 1, 0)).toBe(false)
    expect(core.isIdle(T0 + IDLE_PAUSE_MS, 1)).toBe(false)
    expect(core.isIdle(T0 + IDLE_PAUSE_MS, 0)).toBe(true)
    const batch = core.meta()!.batchId
    expect(core.tick(T0 + IDLE_PAUSE_MS, true)).toEqual([])
    expect(core.meta()!.batchId).toBe(batch)
    // Idle and live: one wake at the round end only. Idle in a break: no alarm.
    expect(core.nextWakeAt(true)).toBe(T0 + 15 * 60_000)
    core.tick(T0 + 15 * 60_000, true)
    expect(core.meta()!.phase).toBe('break')
    expect(core.nextWakeAt(true)).toBeNull()
    // The break passing while idle does not open a round...
    core.tick(T0 + 16 * 60_000, true)
    expect(core.meta()!.phase).toBe('break')
    // ...the next visitor does.
    core.wake(T0 + 20 * 60_000)
    expect(core.meta()!.phase).toBe('live')
  })

  it('a wake long after the round ended closes the stale round, then starts the next', () => {
    const { core, sql } = setup()
    core.wake(T0)
    const stale = core.meta()!.roundId
    const msgs = core.wake(T0 + 10 * LIVE_MS)
    expect(msgs.map((m) => m.type === 'ex.phase' && m.phase)).toEqual(['break', 'live'])
    expect(queued<RoundRecord>(sql, 'rounds').find((r) => r.recordId === stale)!.data.status).toBe('done')
    expect(core.meta()!.roundId).not.toBe(stale)
    expect(core.meta()!.nextBatchAt).toBe(T0 + 10 * LIVE_MS + 1_000)
  })

  it('resuming mid-round restarts the batch clock instead of replaying missed batches', () => {
    const { core } = setup({ liveMs: 15 * 60_000, breakMs: BREAK_MS })
    core.wake(T0)
    core.wake(T0 + 6 * 60_000)
    expect(core.meta()!.nextBatchAt).toBe(T0 + 6 * 60_000 + 1_000)
    expect(core.meta()!.batchId).toBe(1)
  })

  it('a shock does not count as activity', () => {
    const { core } = setup({ liveMs: 15 * 60_000, breakMs: BREAK_MS })
    core.wake(T0)
    core.wake(T0 + IDLE_PAUSE_MS, false)
    core.shock(T0 + IDLE_PAUSE_MS, { newsId: 'n', ticker: 'ORBT', deltaBps: 100, rampBatches: 10 })
    expect(core.isIdle(T0 + IDLE_PAUSE_MS, 0)).toBe(true)
  })
})

describe('shock-first wake', () => {
  it('a fresh room woken only by a shock, with no sockets or orders, goes idle after IDLE_PAUSE_MS', () => {
    const { core } = setup({ liveMs: 15 * 60_000, breakMs: BREAK_MS })
    core.wake(T0, false)
    expect(core.shock(T0, { newsId: 'n1', ticker: 'ORBT', deltaBps: 200, rampBatches: 5 })).toEqual({ ok: true })
    expect(core.meta()).toMatchObject({ phase: 'live', lastActivityAt: T0 })
    expect(core.isIdle(T0 + IDLE_PAUSE_MS - 1, 0)).toBe(false)
    expect(core.isIdle(T0 + IDLE_PAUSE_MS, 0)).toBe(true)
    // Idle: no batches run, and the only wake left is the round end.
    expect(core.nextWakeAt(true)).toBe(T0 + 15 * 60_000)
  })

  it('treats a missing lastActivityAt as long ago, not as never idle', () => {
    const { core, sql } = setup()
    core.wake(T0, false)
    sql.exec(`DELETE FROM meta WHERE k = 'lastActivityAt'`)
    expect(core.isIdle(T0 + 1, 0)).toBe(true)
    expect(core.isIdle(T0 + 1, 1)).toBe(false)
  })
})

describe('a failure while opening the next round', () => {
  /** A core whose next round open throws once (newId is first called inside openRound). */
  function setupFailingOpen() {
    const { sql, txn } = memoryDb()
    let n = 0
    let failNextOpen = false
    const errors: string[] = []
    const core = new ExchangeCore({
      sql,
      txn,
      durations: { liveMs: LIVE_MS, breakMs: BREAK_MS },
      newId: () => {
        if (failNextOpen) {
          failNextOpen = false
          throw new Error('injected open failure')
        }
        return `id${String(++n).padStart(8, '0')}`
      },
      log: () => {},
      logError: (l) => errors.push(l),
    })
    return { core, sql, errors, armFailure: () => (failNextOpen = true) }
  }

  function playAndClose(core: Core) {
    core.wake(T0)
    place(core, T0, 'userA', { ticker: 'ORBT', side: 'buy', type: 'market', qty: 5 })
    runBatches(core, 1)
    const roundId = core.meta()!.roundId
    return roundId
  }

  const roundRecord = (sql: SqlLike, roundId: string) => queued<RoundRecord>(sql, 'rounds').find((r) => r.recordId === roundId)!.data

  it('at break end leaves the closed round untouched, keeps the break, and the next tick opens a round', () => {
    const { core, sql, errors, armFailure } = setupFailingOpen()
    const oldRound = playAndClose(core)
    core.tick(T0 + LIVE_MS, false)
    const published = roundRecord(sql, oldRound)
    expect(published).toMatchObject({ status: 'done', winnerId: 'userA' })
    expect(published.standings).toHaveLength(1)

    armFailure()
    const msgs = core.tick(T0 + LIVE_MS + BREAK_MS, false)
    const retryAt = T0 + LIVE_MS + 2 * BREAK_MS
    expect(msgs).toEqual([{ type: 'ex.phase', roundId: oldRound, phase: 'break', phaseEndsAt: retryAt }])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/^\[exchange\] round open failed, retrying at \d+: step failed: injected open failure$/)
    expect(core.meta()).toMatchObject({ roundId: oldRound, phase: 'break', phaseEndsAt: retryAt, halted: 0 })
    expect(roundRecord(sql, oldRound)).toEqual(published)

    expect(core.tick(retryAt - 1, false)).toEqual([])
    const next = core.tick(retryAt, false)
    expect(next[0]).toMatchObject({ type: 'ex.phase', phase: 'live' })
    expect(core.meta()!.roundId).not.toBe(oldRound)
    expect(core.meta()!.phase).toBe('live')
    expect(roundRecord(sql, oldRound)).toEqual(published)
  })

  it('on a stale wake, the overdue round still closes with its standings even though the open fails', () => {
    const { core, sql, errors, armFailure } = setupFailingOpen()
    const oldRound = playAndClose(core)
    armFailure()
    const now = T0 + 10 * LIVE_MS
    core.wake(now)
    expect(errors.filter((e) => e.includes('INVARIANT'))).toEqual([])
    const rec = roundRecord(sql, oldRound)
    expect(rec).toMatchObject({ status: 'done', winnerId: 'userA' })
    expect(rec.standings).toHaveLength(1)
    expect(core.meta()).toMatchObject({ roundId: oldRound, phase: 'break', phaseEndsAt: now + BREAK_MS })
    core.tick(now + BREAK_MS, false)
    expect(core.meta()).toMatchObject({ phase: 'live' })
    expect(core.meta()!.roundId).not.toBe(oldRound)
  })
})

describe('invariant self-check', () => {
  it('a broken balance rolls the batch back, logs INVARIANT, and halts the round with no winner', () => {
    const { core, sql, errors } = setup()
    core.wake(T0)
    place(core, T0, 'userA', { ticker: 'ORBT', side: 'buy', type: 'market', qty: 5 })
    const roundId = core.meta()!.roundId
    // Corrupt the maker's reservation behind the engine's back.
    sql.exec(`UPDATE accounts SET reservedCents = reservedCents + 1, cashCents = cashCents - 1 WHERE userId = ?`, MM_BOT_ID)
    const msgs = core.tick(T0 + 1_000, false)

    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/^\[exchange\] INVARIANT /)
    expect(rows(sql, `SELECT * FROM batches`)).toEqual([]) // the batch was rolled back
    expect(core.meta()).toMatchObject({ phase: 'break', halted: 1 })
    expect(msgs).toEqual([{ type: 'ex.phase', roundId, phase: 'break', phaseEndsAt: T0 + 1_000 + BREAK_MS }])
    const rec = queued<RoundRecord>(sql, 'rounds').find((r) => r.recordId === roundId)!.data
    expect(rec).toMatchObject({ status: 'done', standings: [], winnerId: '' })
    expect(place(core, T0 + 1_001, 'userA', { ticker: 'ORBT', side: 'buy', type: 'market', qty: 1 })).toEqual({
      ok: false,
      code: 'round_closed',
    })
    // The next round starts clean.
    core.tick(T0 + 1_000 + BREAK_MS, false)
    expect(core.meta()).toMatchObject({ phase: 'live', halted: 0 })
  })
})

describe('mirror flush', () => {
  it('sends at most the cap per flush, removes only what was sent, and keeps newer versions', async () => {
    const { core, sql } = setup()
    core.wake(T0)
    const total = pendingCount(sql)
    expect(total).toBeGreaterThan(3)
    const sent: string[] = []
    const r1 = await flushMirror(sql, async (w) => {
      sent.push(`${w.collection}/${w.recordId}`)
    }, () => {}, T0, 2)
    expect(r1).toMatchObject({ sent: 2, failed: 0, left: total - 2 })
    expect(sent[0]).toMatch(/^rounds\//) // rounds first

    // A row rewritten while its write is in flight stays queued with the new data.
    const res = place(core, T0, 'userA', { ticker: 'ORBT', side: 'buy', type: 'limit', qty: 1, limitCents: 11_000 })
    if (!res.ok) throw new Error(res.code)
    const r2 = await flushMirror(sql, async (w) => {
      if (w.collection === 'orders') core.cancelOrder(T0, { userId: 'userA', orderId: res.data.orderId })
    }, () => {}, T0, 100)
    expect(r2.left).toBeGreaterThan(0)
    const left = queued<OrderRecord>(sql, 'orders')
    expect(left).toHaveLength(1)
    expect(left[0].data.status).toBe('cancelled')
  })

  it('never drops a row: backs off exponentially, then delivers the rounds done record and a fill', async () => {
    const { core, sql } = setup()
    core.wake(T0)
    place(core, T0, 'userA', { ticker: 'ORBT', side: 'buy', type: 'market', qty: 5 })
    runBatches(core, 1)
    const fillId = queued(sql, 'fills').find((f) => f.actor === 'userA')!.recordId
    const roundId = core.meta()!.roundId
    core.tick(T0 + LIVE_MS, false) // round ends: rounds record goes to 'done'
    expect(queued<{ status: string }>(sql, 'rounds')[0].data.status).toBe('done')
    const total = pendingCount(sql)

    // RecordRoom is down for 8 straight attempts per row.
    const warnings: string[] = []
    const failures = new Map<string, number>()
    let now = T0 + LIVE_MS
    const gaps: number[] = []
    for (let i = 0; i < 8; i++) {
      const r = await flushMirror(sql, async (w) => {
        const k = `${w.collection}/${w.recordId}`
        failures.set(k, (failures.get(k) ?? 0) + 1)
        throw new Error('RecordRoom 503')
      }, (l) => warnings.push(l), now, 1_000)
      expect(r).toMatchObject({ sent: 0, failed: total, left: total })
      // Nothing is due again before the backoff runs out.
      const next = rows<{ t: number }>(sql, `SELECT MIN(nextAt) AS t FROM mirror`)[0].t
      expect((await flushMirror(sql, async () => { throw new Error('must not be called') }, () => {}, next - 1, 1_000)).failed).toBe(0)
      gaps.push(next - now)
      now = next
    }
    expect(gaps).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 64_000, 64_000])
    expect(warnings).toHaveLength(8 * total)
    expect(warnings[0]).toMatch(/^\[exchange\] mirror write failed \(attempt 1\) .*retry in 1s: RecordRoom 503$/)
    expect(pendingCount(sql)).toBe(total)

    // RecordRoom recovers: everything is delivered, including the done round and the fill.
    const delivered: { collection: string; recordId: string; actor: string; data: Record<string, unknown> }[] = []
    const r = await flushMirror(sql, async (w) => {
      delivered.push(w)
    }, () => {}, now, 1_000)
    expect(r).toMatchObject({ sent: total, failed: 0, left: 0 })
    expect(delivered.find((w) => w.collection === 'rounds' && w.recordId === roundId)?.data.status).toBe('done')
    expect(delivered.find((w) => w.collection === 'fills' && w.recordId === fillId)?.actor).toBe('userA')
  })

  it('a retried fill write reuses its recordId and leaves the queue empty', async () => {
    const { core, sql } = setup()
    core.wake(T0)
    const placed = place(core, T0, 'userA', { ticker: 'ORBT', side: 'buy', type: 'market', qty: 5 })
    if (!placed.ok) throw new Error(placed.code)
    const { now } = runBatches(core, 1)
    const batchId = core.meta()!.batchId - 1
    const expected = `${placed.data.orderId}:${batchId}`
    expect(queued(sql, 'fills').map((f) => f.recordId)).toContain(expected)

    const seen: string[] = []
    let rejected = false
    const writer = async (w: { collection: string; recordId: string }) => {
      if (w.collection !== 'fills') return
      seen.push(w.recordId)
      if (!rejected) {
        rejected = true
        throw new Error('transient')
      }
    }
    const first = await flushMirror(sql, writer, () => {}, now, 1_000)
    expect(first.failed).toBe(1)
    const second = await flushMirror(sql, writer, () => {}, now + 1_000, 1_000)
    expect(second.failed).toBe(0)
    expect(seen).toEqual([expected, expected])
    expect(pendingCount(sql)).toBe(0)
  })
})

describe('schema upgrade', () => {
  it('adds the backoff column to a mirror table made before it existed, keeping queued rows', () => {
    const { sql, txn } = memoryDb()
    sql.exec(`CREATE TABLE mirror (
      collection TEXT NOT NULL, recordId TEXT NOT NULL, actor TEXT NOT NULL, data TEXT NOT NULL,
      ver INTEGER NOT NULL, seq INTEGER NOT NULL, prio INTEGER NOT NULL, attempts INTEGER NOT NULL,
      PRIMARY KEY (collection, recordId))`)
    sql.exec(`INSERT INTO mirror VALUES ('rounds', 'r1', '', '{}', 1, 1, 0, 3)`)
    new ExchangeCore({ sql, txn, durations: { liveMs: LIVE_MS, breakMs: BREAK_MS }, newId: () => 'x', log: () => {}, logError: () => {} })
    expect(rows(sql, `SELECT recordId, attempts, nextAt FROM mirror`)).toEqual([{ recordId: 'r1', attempts: 3, nextAt: 0 }])
  })
})

describe('round duration overrides', () => {
  it('uses the contract defaults unless a valid env override is set', async () => {
    const { roundDurations } = await import('./config')
    expect(roundDurations({})).toEqual({ liveMs: 15 * 60_000, breakMs: 2 * 60_000 })
    expect(roundDurations({ EXCHANGE_ROUND_LIVE_MS: '45000', EXCHANGE_ROUND_BREAK_MS: '15000' })).toEqual({ liveMs: 45_000, breakMs: 15_000 })
    expect(roundDurations({ EXCHANGE_ROUND_LIVE_MS: 'abc', EXCHANGE_ROUND_BREAK_MS: '10' })).toEqual({ liveMs: 15 * 60_000, breakMs: 2 * 60_000 })
  })
})
