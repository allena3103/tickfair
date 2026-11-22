import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { test as dsTest, loadAllTestAccounts } from 'deepspace/testing'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ROUND_BREAK_MS } from '../src/shared/contracts'

test.describe('API tests', () => {
  test('auth proxy forwards to auth worker', async ({ request }) => {
    const res = await request.get('/api/auth/ok')
    expect(res.ok()).toBeTruthy()
  })

  test('WebSocket endpoint exists', async ({ page }) => {
    // /home is a dynamic page (under src/pages/(app)/), so mounting it boots
    // the providers and auto-connects the records WebSocket. The static
    // landing at '/' deliberately does neither — see smoke.spec.ts.
    await page.goto('/home')
    // Wait for the app to connect its WebSocket (it auto-connects on mount)
    await page.waitForSelector('[data-testid="app-navigation"]', { timeout: 15000 })
    // If the app loaded and connected, the WS endpoint works
  })
})

// ---------------------------------------------------------------------------
// News: owner-only `breakingNews` and the server-only Anthropic integration.
// No test here can reach a paid call: every request is refused before the
// LLM, and the proxy probe sends a body the integration's validator rejects.
// ---------------------------------------------------------------------------

/** Bearer for the page's signed-in session. Never logged. */
async function bearerFor(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const res = await fetch('/api/auth/token', { method: 'POST', credentials: 'include' })
    const json = (await res.json()) as { token?: string }
    return json.token ?? ''
  })
}

test.describe('News API', () => {
  test('breakingNews without auth is 401', async ({ request }) => {
    const res = await request.post('/api/actions/breakingNews', { data: {} })
    expect(res.status()).toBe(401)
  })

  test('anthropic proxy without auth is 403', async ({ request }) => {
    const res = await request.post('/api/integrations/anthropic/chat-completion', { data: {} })
    expect(res.status()).toBe(403)
  })
})

dsTest.describe('News API (signed in)', () => {
  dsTest.skip(loadAllTestAccounts().length < 1, 'Needs 1 usable test account')

  dsTest('breakingNews as a non-owner is forbidden', async ({ users }) => {
    const [a] = await users(1)
    await a.page.goto('/home')
    const token = await bearerFor(a.page)
    expect(token).not.toBe('')
    const res = await a.page.request.post('/api/actions/breakingNews', {
      headers: { Authorization: `Bearer ${token}` },
      data: { ticker: 'ORBT' },
    })
    expect(res.status()).toBe(200)
    expect(await res.json()).toEqual({ success: false, error: 'forbidden' })
  })

  dsTest('a signed-in client cannot call the anthropic integration', async ({ users }) => {
    const [a] = await users(1)
    await a.page.goto('/home')
    const token = await bearerFor(a.page)
    // `{}` has no `messages`, so even if the proxy regressed, the api-worker
    // validator would refuse it before any model runs. The app must refuse
    // it first: 403 for every owner-billed integration.
    const res = await a.page.request.post('/api/integrations/anthropic/chat-completion', {
      headers: { Authorization: `Bearer ${token}` },
      data: {},
    })
    expect(res.status()).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// Exchange: order entry, cancel, two-user batch, simultaneous fairness.
// Bots trade too, so assertions are about rules (one price per batch, typed
// rejections, ownership), never exact quantities. Tokens only ever travel as
// an Authorization header or WS query param; nothing is logged.
//
// Assumes the default round durations (ROUND_LIVE_MS 15 min, ROUND_BREAK_MS
// 2 min): no EXCHANGE_ROUND_LIVE_MS / EXCHANGE_ROUND_BREAK_MS overrides in
// .dev.vars. Timeouts are sized from ROUND_BREAK_MS, and the two-user test needs
// a live round with at least 60 s left.
// ---------------------------------------------------------------------------

const APP_ID = /DEEPSPACE_APP_ID\s*=\s*"([^"]+)"/.exec(
  readFileSync(fileURLToPath(new URL('../wrangler.toml', import.meta.url)), 'utf8'),
)?.[1] as string

type Rec<T> = { recordId: string; data: T }
type ActResult = { success: boolean; error?: string; data?: { orderId: string; batchId: number } }

async function act(page: Page, token: string, name: string, params: Record<string, unknown>): Promise<ActResult> {
  const res = await page.request.post(`/api/actions/${name}`, { headers: { Authorization: `Bearer ${token}` }, data: params })
  expect(res.status()).toBe(200)
  return (await res.json()) as ActResult
}

/** One RecordRoom query over the app's own WebSocket, as the signed-in user (RBAC applies). */
async function query<T>(page: Page, token: string, collection: string, where: Record<string, unknown>): Promise<Rec<T>[]> {
  return page.evaluate(
    ({ appId, token, collection, where }) =>
      new Promise<Rec<T>[]>((resolve, reject) => {
        const proto = location.protocol === 'https:' ? 'wss' : 'ws'
        const ws = new WebSocket(`${proto}://${location.host}/ws/app:${appId}?token=${encodeURIComponent(token)}`)
        const timer = setTimeout(() => {
          ws.close()
          reject(new Error('query timeout'))
        }, 10_000)
        ws.onopen = () =>
          ws.send(JSON.stringify({ type: 'core.subscribe', payload: { subscriptionId: 'q', query: { collection, where, limit: 500 } } }))
        ws.onmessage = (ev) => {
          const msg = JSON.parse(String(ev.data))
          if (msg.type === 'core.query_result' && msg.payload?.subscriptionId === 'q') {
            clearTimeout(timer)
            ws.close()
            resolve(msg.payload.records as Rec<T>[])
          }
        }
      }),
    { appId: APP_ID, token, collection, where },
  )
}

/** Poll a query until `ok` holds (the mirror trails the batch by a tick or two). */
async function until<T>(
  page: Page,
  token: string,
  collection: string,
  where: Record<string, unknown>,
  ok: (r: Rec<T>[]) => boolean,
): Promise<Rec<T>[]> {
  for (let i = 0; i < 40; i++) {
    const r = await query<T>(page, token, collection, where)
    if (ok(r)) return r
    await page.waitForTimeout(500)
  }
  throw new Error(`timed out waiting on ${collection} ${JSON.stringify(where)}`)
}

type Snapshot = { roundId: string; phase: string; phaseEndsAt: number; batchId: number; last: Record<string, number> }

/** The exchange stream's first message (ex.snapshot). */
async function exchangeSnapshot(page: Page, token: string): Promise<Snapshot> {
  return page.evaluate(
    ({ appId, token }) =>
      new Promise<Snapshot>((resolve, reject) => {
        const proto = location.protocol === 'https:' ? 'wss' : 'ws'
        const ws = new WebSocket(`${proto}://${location.host}/ws/exchange/exchange:${appId}?token=${encodeURIComponent(token)}`)
        const timer = setTimeout(() => {
          ws.close()
          reject(new Error('snapshot timeout'))
        }, 10_000)
        ws.onmessage = (ev) => {
          const msg = JSON.parse(String(ev.data))
          if (msg.type === 'ex.snapshot') {
            clearTimeout(timer)
            ws.close()
            resolve(msg as Snapshot)
          }
        }
      }),
    { appId: APP_ID, token },
  )
}

/**
 * A snapshot of a live round with at least `minLeftMs` to go. If the round is
 * in its break, or about to end, waits until that phase is over (+1 s) and
 * looks again, so no test depends on where the wall clock falls in a round.
 * Waits at most through one round end and one full break.
 */
async function liveSnapshot(page: Page, token: string, minLeftMs: number): Promise<Snapshot> {
  for (let i = 0; i < 4; i++) {
    const snap = await exchangeSnapshot(page, token)
    const left = snap.phaseEndsAt - Date.now()
    if (snap.phase === 'live' && left >= minLeftMs) return snap
    await page.waitForTimeout(Math.max(1_000, left + 1_000))
  }
  throw new Error('no live round with enough time left')
}

/** Room for one wait through a round end and a full break, plus the test itself. */
const PHASE_SAFE_TIMEOUT = ROUND_BREAK_MS + 2 * 60_000

const ROLLOVER = Symbol('rollover')
type MaybeRollover<T> = T | typeof ROLLOVER

/** True if any action result says the round closed under us. */
function closed(...results: ActResult[]): boolean {
  return results.some((r) => r.error === 'round_closed')
}

/**
 * Run `scenario` inside one live round. The scenario returns ROLLOVER if the
 * round changed under it (a round_closed reply, or a different roundId on a
 * re-check); then it runs once more in the next round.
 */
async function inOneRound<T>(
  page: Page,
  token: string,
  minLeftMs: number,
  scenario: (snap: Snapshot) => Promise<MaybeRollover<T>>,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await scenario(await liveSnapshot(page, token, minLeftMs))
    if (out !== ROLLOVER) return out
  }
  throw new Error('the round rolled over during both attempts')
}

/** Re-snapshot until batch `batchId` has cleared. False if round `roundId` ended first. */
async function clearedInRound(page: Page, token: string, roundId: string, batchId: number): Promise<boolean> {
  for (let i = 0; i < 10; i++) {
    const s = await exchangeSnapshot(page, token)
    if (s.roundId !== roundId || s.phase !== 'live') return false
    if (s.batchId > batchId) return true
    await page.waitForTimeout(500)
  }
  throw new Error(`batch ${batchId} did not clear`)
}

/** ±10% band of `last`, rounded inward (engine-core's priceBand rule). */
function band(last: number): { lo: number; hi: number } {
  return { lo: Math.ceil((last * 9_000) / 10_000), hi: Math.floor((last * 11_000) / 10_000) }
}

type OrderData = { status: string; filledQty: number; batchId: number }
type FillData = { userId: string; orderId: string; priceCents: number; batchId: number; ticker: string }
type PortfolioData = { userId: string; cashCents: number; holdings: Record<string, number> }
type TapeData = { clearCents: number; volume: number; batchId: number }

async function signedIn(users: (n: number) => Promise<{ page: Page }[]>, n: number) {
  const list = await users(n)
  await Promise.all(list.map((u) => u.page.goto('/home')))
  const tokens = await Promise.all(list.map((u) => bearerFor(u.page)))
  for (const t of tokens) expect(t).not.toBe('')
  return list.map((u, i) => ({ page: u.page, token: tokens[i] }))
}

test.describe('Exchange API (signed out)', () => {
  for (const name of ['placeOrder', 'cancelOrder']) {
    test(`${name} without auth is 401`, async ({ request }) => {
      const res = await request.post(`/api/actions/${name}`, {
        data: { ticker: 'ORBT', side: 'buy', type: 'limit', qty: 1, limitCents: 12_000, orderId: 'o-x' },
      })
      expect(res.status()).toBe(401)
    })
  }
})

dsTest.describe('Exchange API (signed in)', () => {
  dsTest.skip(loadAllTestAccounts().length < 2, 'Needs 2 usable test accounts')

  dsTest('typed rejections for bad ticker, qty, price, band, and insufficient cash', async ({ users }) => {
    dsTest.setTimeout(PHASE_SAFE_TIMEOUT)
    const [a] = await signedIn(users, 1)
    await inOneRound(a.page, a.token, 20_000, async (snap) => {
      const last = snap.last.ORBT
      const cases: [Record<string, unknown>, string][] = [
        [{ ticker: 'AAPL', side: 'buy', type: 'limit', qty: 1, limitCents: last }, 'invalid_ticker'],
        [{ ticker: 'ORBT', side: 'buy', type: 'limit', qty: 0, limitCents: last }, 'invalid_qty'],
        [{ ticker: 'ORBT', side: 'buy', type: 'limit', qty: 1.5, limitCents: last }, 'invalid_qty'],
        [{ ticker: 'ORBT', side: 'buy', type: 'limit', qty: 1, limitCents: -1 }, 'invalid_price'],
        [{ ticker: 'ORBT', side: 'buy', type: 'limit', qty: 1, limitCents: last * 3 }, 'outside_band'],
        // 10,000 shares at ~$100+ is far more than $100k.
        [{ ticker: 'ORBT', side: 'buy', type: 'limit', qty: 10_000, limitCents: last }, 'insufficient_cash'],
      ]
      const results: ActResult[] = []
      for (const [params] of cases) results.push(await act(a.page, a.token, 'placeOrder', params))
      if (closed(...results)) return ROLLOVER
      cases.forEach(([params, code], i) => expect(results[i], JSON.stringify(params)).toEqual({ success: false, error: code }))
      return true
    })
  })

  dsTest('a valid order returns orderId and batchId; only its owner can cancel or see it', async ({ users }) => {
    dsTest.setTimeout(PHASE_SAFE_TIMEOUT)
    const [a, b] = await signedIn(users, 2)
    await inOneRound(a.page, a.token, 30_000, async (snap) => {
      // A resting bid at the bottom of the band, so it is still open when we cancel it.
      const placed = await act(a.page, a.token, 'placeOrder', {
        ticker: 'CURA', side: 'buy', type: 'limit', qty: 1, limitCents: band(snap.last.CURA).lo,
      })
      if (closed(placed)) return ROLLOVER
      expect(placed.success).toBe(true)
      expect(placed.data?.orderId).toMatch(/^o-/)
      expect(Number.isInteger(placed.data?.batchId)).toBe(true)
      const orderId = placed.data!.orderId

      expect(await act(b.page, b.token, 'cancelOrder', { orderId })).toEqual({ success: false, error: 'not_owner' })
      expect(await act(a.page, a.token, 'cancelOrder', { orderId: 'o-00000000-0000-0000-0000-000000000000' })).toEqual({
        success: false,
        error: 'not_found',
      })
      // If a bot happened to sell into it, the order is final instead; both are correct.
      const cancelled = await act(a.page, a.token, 'cancelOrder', { orderId })
      expect([JSON.stringify({ success: true, data: {} }), JSON.stringify({ success: false, error: 'already_final' })]).toContain(
        JSON.stringify(cancelled),
      )
      expect(await act(a.page, a.token, 'cancelOrder', { orderId })).toEqual({ success: false, error: 'already_final' })

      // Orders are private: A sees the mirror row, B does not.
      await until<OrderData>(a.page, a.token, 'orders', { roundId: snap.roundId }, (r) => r.some((o) => o.recordId === orderId))
      const bView = await query<OrderData>(b.page, b.token, 'orders', { roundId: snap.roundId })
      expect(bView.some((o) => o.recordId === orderId)).toBe(false)
      return true
    })
  })

  dsTest('two users crossing in one batch both fill at one price; portfolios and tape update', async ({ users }) => {
    dsTest.setTimeout(PHASE_SAFE_TIMEOUT + 120_000)
    const [a, b] = await signedIn(users, 2)

    const { roundId, pair } = await inOneRound(a.page, a.token, 60_000, async (snap) => {
      const roundId = snap.roundId
      // Long-only: B first buys shares so it has something to sell.
      const seed = await act(b.page, b.token, 'placeOrder', { ticker: 'VOLT', side: 'buy', type: 'market', qty: 10 })
      if (closed(seed)) return ROLLOVER
      expect(seed.success).toBe(true)
      await until<OrderData>(b.page, b.token, 'orders', { roundId }, (r) =>
        r.some((o) => o.recordId === seed.data!.orderId && o.data.filledQty >= 2),
      )

      let pair: { a: string; b: string; batchId: number } | null = null
      for (let attempt = 0; attempt < 3 && !pair; attempt++) {
        const now = await exchangeSnapshot(a.page, a.token)
        if (now.roundId !== roundId || now.phase !== 'live') return ROLLOVER
        const { lo, hi } = band(now.last.VOLT)
        const [ra, rb] = await Promise.all([
          act(a.page, a.token, 'placeOrder', { ticker: 'VOLT', side: 'buy', type: 'limit', qty: 2, limitCents: hi }),
          act(b.page, b.token, 'placeOrder', { ticker: 'VOLT', side: 'sell', type: 'limit', qty: 2, limitCents: lo }),
        ])
        if (closed(ra, rb)) return ROLLOVER
        expect(ra.success && rb.success, JSON.stringify([ra, rb])).toBe(true)
        if (ra.data!.batchId === rb.data!.batchId) {
          pair = { a: ra.data!.orderId, b: rb.data!.orderId, batchId: ra.data!.batchId }
        } else {
          // The two requests straddled a batch boundary; withdraw whatever is left and retry.
          await act(a.page, a.token, 'cancelOrder', { orderId: ra.data!.orderId })
          await act(b.page, b.token, 'cancelOrder', { orderId: rb.data!.orderId })
        }
      }
      expect(pair, 'both orders acked in the same batch').not.toBeNull()
      // The pair's batch must have cleared in this same round; a round end would have cancelled it.
      if (!(await clearedInRound(a.page, a.token, roundId, pair!.batchId))) return ROLLOVER
      return { roundId, pair: pair! }
    })
    const { batchId } = pair

    const aFills = await until<FillData>(a.page, a.token, 'fills', { roundId, batchId }, (r) => r.some((f) => f.data.orderId === pair.a))
    const bFills = await until<FillData>(b.page, b.token, 'fills', { roundId, batchId }, (r) => r.some((f) => f.data.orderId === pair.b))
    const fa = aFills.find((f) => f.data.orderId === pair.a)!
    const fb = bFills.find((f) => f.data.orderId === pair.b)!
    expect(fa.recordId).toBe(`${pair.a}:${batchId}`)
    expect(fa.data.priceCents).toBe(fb.data.priceCents)

    const tape = await until<TapeData>(a.page, a.token, 'tape', { roundId, ticker: 'VOLT', batchId }, (r) => r.length === 1)
    expect(tape[0].recordId).toBe(`${roundId}:VOLT:${batchId}`)
    expect(tape[0].data.clearCents).toBe(fa.data.priceCents)
    expect(tape[0].data.volume).toBeGreaterThan(0)

    // Portfolios are public: A can read both, and both moved off the starting $100k.
    const aId = fa.data.userId
    const bId = fb.data.userId
    const pfs = await until<PortfolioData>(a.page, a.token, 'portfolios', { roundId }, (r) =>
      r.some((p) => p.data.userId === aId && (p.data.holdings.VOLT ?? 0) >= 2) && r.some((p) => p.data.userId === bId),
    )
    expect(pfs.find((p) => p.data.userId === aId)!.data.cashCents).toBeLessThan(10_000_000)
    expect(pfs.find((p) => p.data.userId === bId)!.data.cashCents).not.toBe(10_000_000)
  })

  dsTest('identical simultaneous buys share one batch and one clearing price', async ({ users }) => {
    dsTest.setTimeout(PHASE_SAFE_TIMEOUT + 120_000)
    const [a, b] = await signedIn(users, 2)

    const { roundId, batchId } = await inOneRound(a.page, a.token, 30_000, async (snap) => {
      let acked: number | null = null
      for (let attempt = 0; attempt < 3 && acked === null; attempt++) {
        const params = { ticker: 'ORBT', side: 'buy', type: 'market', qty: 3 }
        const [ra, rb] = await Promise.all([act(a.page, a.token, 'placeOrder', params), act(b.page, b.token, 'placeOrder', params)])
        if (closed(ra, rb)) return ROLLOVER
        expect(ra.success && rb.success, JSON.stringify([ra, rb])).toBe(true)
        if (ra.data!.batchId === rb.data!.batchId) acked = ra.data!.batchId
      }
      expect(acked, 'both buys acked in the same batch').not.toBeNull()
      if (!(await clearedInRound(a.page, a.token, snap.roundId, acked!))) return ROLLOVER
      return { roundId: snap.roundId, batchId: acked! }
    })

    // Whatever each got (bots trade too), every fill in that batch has the tape's single price.
    const tape = await until<TapeData>(a.page, a.token, 'tape', { roundId, ticker: 'ORBT', batchId }, (r) => r.length === 1)
    const fa = await until<FillData>(a.page, a.token, 'fills', { roundId, batchId, ticker: 'ORBT' }, (r) => r.length > 0)
    const fb = await until<FillData>(b.page, b.token, 'fills', { roundId, batchId, ticker: 'ORBT' }, (r) => r.length > 0)
    for (const f of [...fa, ...fb]) expect(f.data.priceCents).toBe(tape[0].data.clearCents)
  })
})
