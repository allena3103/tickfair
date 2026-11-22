/**
 * Property tests: a seeded random order stream run through reserve → clear →
 * settle → cancel for many batches, checking the money invariants after every
 * batch. Deterministic: a fixed PRNG seed, no Math.random, no clock.
 */
import { describe, expect, it } from 'vitest'
import { TICKERS, type Side, type Ticker } from '../../shared/contracts'
import {
  checkAndReserve,
  clearBatch,
  clearingPrice,
  emptyAccount,
  marketLimit,
  priceBand,
  releaseOrder,
  settleFill,
  type Account,
  type BookOrder,
  type ClearResult,
} from './index'

/** mulberry32: tiny seeded PRNG, good enough for test streams. */
function prng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T,>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)],
  }
}

type Totals = { cash: number; shares: Record<Ticker, number> }

function totals(accounts: Map<string, Account>): Totals {
  const shares = Object.fromEntries(TICKERS.map((t) => [t, 0])) as Record<Ticker, number>
  let cash = 0
  for (const a of accounts.values()) {
    cash += a.cashCents + a.reservedCents
    for (const t of TICKERS) shares[t] += a.holdings[t].qty
  }
  return { cash, shares }
}

function assertAccountsSound(accounts: Map<string, Account>, book: BookOrder[]) {
  for (const [id, a] of accounts) {
    expect(a.cashCents, `${id} cash`).toBeGreaterThanOrEqual(0)
    expect(a.reservedCents, `${id} reserved`).toBeGreaterThanOrEqual(0)
    for (const t of TICKERS) {
      const h = a.holdings[t]
      expect(h.reservedQty, `${id} ${t} reservedQty`).toBeGreaterThanOrEqual(0)
      expect(h.qty, `${id} ${t} qty >= reservedQty`).toBeGreaterThanOrEqual(h.reservedQty)
    }
    // Reservations equal exactly what the trader's open orders hold.
    const mine = book.filter((o) => o.traderId === id)
    expect(a.reservedCents, `${id} reserved matches book`).toBe(
      mine.filter((o) => o.side === 'buy').reduce((s, o) => s + o.remaining * o.limitCents, 0),
    )
    for (const t of TICKERS) {
      expect(a.holdings[t].reservedQty, `${id} ${t} reservedQty matches book`).toBe(
        mine.filter((o) => o.side === 'sell' && o.ticker === t).reduce((s, o) => s + o.remaining, 0),
      )
    }
  }
}

function assertClearSound(res: ClearResult, before: BookOrder[], lastCents: number) {
  const byId = new Map(before.map((o) => [o.orderId, o]))
  const seen = new Set<string>()
  let buyVol = 0
  let sellVol = 0
  for (const f of res.fills) {
    const o = byId.get(f.orderId)!
    expect(o, 'fill refers to a book order').toBeDefined()
    expect(seen.has(f.orderId), 'one fill per order per batch').toBe(false)
    seen.add(f.orderId)
    expect(f.qty).toBeGreaterThan(0)
    expect(f.qty, 'fill <= remaining').toBeLessThanOrEqual(o.remaining)
    expect(f.priceCents, 'uniform price').toBe(res.clearCents)
    expect(f.side).toBe(o.side)
    expect(f.traderId).toBe(o.traderId)
    if (f.side === 'buy') {
      expect(f.priceCents, 'buy price <= limit').toBeLessThanOrEqual(o.limitCents)
      buyVol += f.qty
    } else {
      expect(f.priceCents, 'sell price >= limit').toBeGreaterThanOrEqual(o.limitCents)
      sellVol += f.qty
    }
  }
  expect(buyVol).toBe(res.volume)
  expect(sellVol).toBe(res.volume)

  // Volume is the maximum possible over every integer price (not just candidates).
  const live = before.filter((o) => o.remaining > 0)
  if (live.length > 0) {
    const prices = live.map((o) => o.limitCents)
    let maxV = 0
    for (let p = Math.min(...prices); p <= Math.max(...prices); p++) {
      const d = live.filter((o) => o.side === 'buy' && o.limitCents >= p).reduce((s, o) => s + o.remaining, 0)
      const s = live.filter((o) => o.side === 'sell' && o.limitCents <= p).reduce((s2, o) => s2 + o.remaining, 0)
      maxV = Math.max(maxV, Math.min(d, s))
    }
    expect(res.volume, 'volume is maximal').toBe(maxV)
  }

  // After clearing, the remaining book does not cross.
  const filled = new Map(res.fills.map((f) => [f.orderId, f.qty]))
  const left = live.map((o) => ({ ...o, remaining: o.remaining - (filled.get(o.orderId) ?? 0) }))
  const bestBid = Math.max(-Infinity, ...left.filter((o) => o.side === 'buy' && o.remaining > 0).map((o) => o.limitCents))
  const bestAsk = Math.min(Infinity, ...left.filter((o) => o.side === 'sell' && o.remaining > 0).map((o) => o.limitCents))
  expect(bestBid < bestAsk, `remaining book uncrossed (${bestBid} < ${bestAsk})`).toBe(true)

  // Reproducible: same input, shuffled, gives an identical result.
  const again = clearBatch({ roundId: 'R', ticker: res.ticker, batchId: res.batchId, lastCents, orders: [...before].reverse() })
  expect(again).toEqual(res)
}

function runStream(seed: number, batches: number) {
  const rnd = prng(seed)
  const traders = Array.from({ length: 8 }, (_, i) => `T${i}`)
  const accounts = new Map<string, Account>()
  for (const id of traders) {
    const a = emptyAccount(rnd.int(50_000, 2_000_000))
    for (const t of TICKERS) a.holdings[t] = { qty: rnd.int(0, 400), reservedQty: 0 }
    accounts.set(id, a)
  }
  const last: Record<Ticker, number> = { ORBT: 1_000, CURA: 2_500, VOLT: 400 }
  let book: BookOrder[] = []
  let nextId = 0
  let stats = { fills: 0, clears: 0, rejects: 0, accepted: 0 }

  for (let batchId = 1; batchId <= batches; batchId++) {
    // 1. New orders arrive.
    const arrivals = rnd.int(0, 12)
    for (let k = 0; k < arrivals; k++) {
      const traderId = rnd.pick(traders)
      const ticker = rnd.pick(TICKERS)
      const side: Side = rnd.next() < 0.5 ? 'buy' : 'sell'
      const { lo, hi } = priceBand(last[ticker])
      const limitCents = rnd.next() < 0.15 ? marketLimit(side, last[ticker]) : rnd.int(lo, hi)
      const qty = rnd.next() < 0.05 ? rnd.int(-5, 0) : rnd.int(1, rnd.next() < 0.1 ? 500 : 40)
      const openOrders = book.filter((o) => o.traderId === traderId)
      const r = checkAndReserve(accounts.get(traderId)!, { side, ticker, qty, limitCents }, { lastCents: last[ticker], openOrders })
      if (!r.ok) {
        stats.rejects++
        continue
      }
      stats.accepted++
      accounts.set(traderId, r.acct)
      book.push({ orderId: `o${String(nextId++).padStart(6, '0')}`, traderId, ticker, side, limitCents, remaining: qty, batchId })
    }
    assertAccountsSound(accounts, book)

    // 2. Clear each ticker and settle. Total cash and shares must not change.
    const before = totals(accounts)
    for (const ticker of TICKERS) {
      const orders = book.filter((o) => o.ticker === ticker)
      const res = clearBatch({ roundId: 'R', ticker, batchId, lastCents: last[ticker], orders })
      expect(res).toEqual(clearBatch({ roundId: 'R', ticker, batchId, lastCents: last[ticker], orders }))
      if (orders.length > 0) assertClearSound(res, orders, last[ticker])
      expect(clearingPrice(orders, last[ticker])).toEqual(
        res.clearCents === null ? null : { clearCents: res.clearCents, volume: res.volume },
      )
      if (res.clearCents === null) continue
      stats.clears++
      const byId = new Map(orders.map((o) => [o.orderId, o]))
      for (const f of res.fills) {
        stats.fills++
        const o = byId.get(f.orderId)!
        accounts.set(f.traderId, settleFill(accounts.get(f.traderId)!, f, o.limitCents))
        o.remaining -= f.qty
      }
      last[ticker] = res.clearCents
    }
    book = book.filter((o) => o.remaining > 0)
    expect(totals(accounts), `conservation at batch ${batchId}`).toEqual(before)
    assertAccountsSound(accounts, book)

    // 3. Some resting orders are cancelled.
    const keep: BookOrder[] = []
    for (const o of book) {
      if (rnd.next() < 0.08) accounts.set(o.traderId, releaseOrder(accounts.get(o.traderId)!, o))
      else keep.push(o)
    }
    book = keep
    expect(totals(accounts), `cancel conserves at batch ${batchId}`).toEqual(before)
    assertAccountsSound(accounts, book)
  }

  // Round end: release everything; nothing may stay reserved.
  const before = totals(accounts)
  for (const o of book) accounts.set(o.traderId, releaseOrder(accounts.get(o.traderId)!, o))
  for (const a of accounts.values()) {
    expect(a.reservedCents).toBe(0)
    for (const t of TICKERS) expect(a.holdings[t].reservedQty).toBe(0)
  }
  expect(totals(accounts)).toEqual(before)
  return stats
}

describe('property: seeded random order stream', () => {
  it('1,200 batches x 3 tickers keep money conserved and invariants intact (seed 1)', () => {
    const stats = runStream(1, 1_200)
    // Make sure the stream actually exercised the engine.
    expect(stats.clears).toBeGreaterThan(500)
    expect(stats.fills).toBeGreaterThan(2_000)
    expect(stats.rejects).toBeGreaterThan(0)
  }, 60_000)

  it('a second seed (seed 20261121, 600 batches) also holds', () => {
    const stats = runStream(20_261_121, 600)
    expect(stats.clears).toBeGreaterThan(200)
  }, 60_000)

  it('the whole stream is reproducible', () => {
    expect(runStream(7, 150)).toEqual(runStream(7, 150))
  }, 60_000)
})
