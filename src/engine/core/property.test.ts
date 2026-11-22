/**
 * Property tests: a seeded random order stream run through reserve → clear →
 * settle → cancel for many batches, checking the money invariants after every
 * batch. Deterministic: a fixed PRNG seed, no Math.random, no clock.
 *
 * Speed: the hot loop never calls expect(). Every check is plain code that
 * records a violation message; each test asserts once that the list is empty.
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

/** Collects violations. Stops storing after 50 so a broken engine can't blow up memory. */
class Violations {
  readonly list: string[] = []
  fail(msg: string) {
    if (this.list.length < 50) this.list.push(msg)
  }
}

/** ClearResult and clearingPrice output are plain JSON values, so this is an exact equality check. */
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

type Totals = { cash: number; ORBT: number; CURA: number; VOLT: number }

function totals(accounts: Map<string, Account>): Totals {
  const t: Totals = { cash: 0, ORBT: 0, CURA: 0, VOLT: 0 }
  for (const a of accounts.values()) {
    t.cash += a.cashCents + a.reservedCents
    t.ORBT += a.holdings.ORBT.qty
    t.CURA += a.holdings.CURA.qty
    t.VOLT += a.holdings.VOLT.qty
  }
  return t
}

function checkConserved(v: Violations, now: Totals, before: Totals, where: string) {
  if (!same(now, before)) v.fail(`${where}: totals ${JSON.stringify(now)} != ${JSON.stringify(before)}`)
}

/**
 * No negative cash, reserved, qty or reservedQty; qty >= reservedQty; and every
 * reservation equals exactly what that trader's open orders hold. One pass over the book.
 */
function checkAccounts(v: Violations, accounts: Map<string, Account>, book: BookOrder[], where: string) {
  const held = new Map<string, { cents: number; ORBT: number; CURA: number; VOLT: number }>()
  for (const id of accounts.keys()) held.set(id, { cents: 0, ORBT: 0, CURA: 0, VOLT: 0 })
  for (const o of book) {
    const h = held.get(o.traderId)!
    if (o.side === 'buy') h.cents += o.remaining * o.limitCents
    else h[o.ticker] += o.remaining
  }
  for (const [id, a] of accounts) {
    const h = held.get(id)!
    if (a.cashCents < 0) v.fail(`${where}: ${id} cash ${a.cashCents} < 0`)
    if (a.reservedCents < 0) v.fail(`${where}: ${id} reserved ${a.reservedCents} < 0`)
    if (a.reservedCents !== h.cents) v.fail(`${where}: ${id} reserved ${a.reservedCents} != book ${h.cents}`)
    for (const t of TICKERS) {
      const { qty, reservedQty } = a.holdings[t]
      if (reservedQty < 0) v.fail(`${where}: ${id} ${t} reservedQty ${reservedQty} < 0`)
      if (qty < reservedQty) v.fail(`${where}: ${id} ${t} qty ${qty} < reservedQty ${reservedQty}`)
      if (reservedQty !== h[t]) v.fail(`${where}: ${id} ${t} reservedQty ${reservedQty} != book ${h[t]}`)
    }
  }
}

function checkClear(v: Violations, res: ClearResult, before: BookOrder[], lastCents: number, where: string) {
  const byId = new Map<string, BookOrder>()
  for (const o of before) byId.set(o.orderId, o)
  const filled = new Map<string, number>()
  let buyVol = 0
  let sellVol = 0
  for (const f of res.fills) {
    const o = byId.get(f.orderId)
    if (!o) {
      v.fail(`${where}: fill for unknown order ${f.orderId}`)
      continue
    }
    if (filled.has(f.orderId)) v.fail(`${where}: two fills for ${f.orderId}`)
    filled.set(f.orderId, f.qty)
    if (!(f.qty > 0)) v.fail(`${where}: fill qty ${f.qty} <= 0`)
    if (f.qty > o.remaining) v.fail(`${where}: fill ${f.qty} > remaining ${o.remaining}`)
    if (f.priceCents !== res.clearCents) v.fail(`${where}: fill price ${f.priceCents} != clear ${res.clearCents}`)
    if (f.side !== o.side || f.traderId !== o.traderId) v.fail(`${where}: fill ${f.orderId} side/trader mismatch`)
    if (f.side === 'buy') {
      if (f.priceCents > o.limitCents) v.fail(`${where}: buy price ${f.priceCents} > limit ${o.limitCents}`)
      buyVol += f.qty
    } else {
      if (f.priceCents < o.limitCents) v.fail(`${where}: sell price ${f.priceCents} < limit ${o.limitCents}`)
      sellVol += f.qty
    }
  }
  if (buyVol !== res.volume || sellVol !== res.volume) {
    v.fail(`${where}: buy vol ${buyVol}, sell vol ${sellVol}, reported ${res.volume}`)
  }

  // Volume is the maximum possible over EVERY integer price in [min limit, max limit]
  // (not just the engine's candidates). Prefix sums give D(p) and S(p) for all p in one pass.
  let lo = Infinity
  let hi = -Infinity
  for (const o of before) {
    if (o.remaining <= 0) continue
    if (o.limitCents < lo) lo = o.limitCents
    if (o.limitCents > hi) hi = o.limitCents
  }
  if (lo <= hi) {
    const width = hi - lo + 1
    const buyAt = new Float64Array(width)
    const sellAt = new Float64Array(width)
    for (const o of before) {
      if (o.remaining <= 0) continue
      if (o.side === 'buy') buyAt[o.limitCents - lo] += o.remaining
      else sellAt[o.limitCents - lo] += o.remaining
    }
    // D(p) = buys with limit >= p (suffix sum); S(p) = sells with limit <= p (prefix sum).
    const demand = new Float64Array(width)
    let acc = 0
    for (let i = width - 1; i >= 0; i--) demand[i] = acc += buyAt[i]
    let supply = 0
    let maxV = 0
    for (let i = 0; i < width; i++) {
      supply += sellAt[i]
      const vol = Math.min(demand[i], supply)
      if (vol > maxV) maxV = vol
    }
    if (res.volume !== maxV) v.fail(`${where}: volume ${res.volume} is not the maximum ${maxV}`)
  }

  // After clearing, the remaining book does not cross.
  let bestBid = -Infinity
  let bestAsk = Infinity
  for (const o of before) {
    if (o.remaining - (filled.get(o.orderId) ?? 0) <= 0) continue
    if (o.side === 'buy') bestBid = Math.max(bestBid, o.limitCents)
    else bestAsk = Math.min(bestAsk, o.limitCents)
  }
  if (!(bestBid < bestAsk)) v.fail(`${where}: remaining book crosses (${bestBid} >= ${bestAsk})`)

  // Reproducible: same input, reversed, gives an identical result.
  const again = clearBatch({ roundId: 'R', ticker: res.ticker, batchId: res.batchId, lastCents, orders: [...before].reverse() })
  if (!same(again, res)) v.fail(`${where}: reversed input gave a different ClearResult`)
}

function runStream(seed: number, batches: number) {
  const v = new Violations()
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
  const stats = { fills: 0, clears: 0, rejects: 0, accepted: 0 }

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
    checkAccounts(v, accounts, book, `batch ${batchId} after arrivals`)

    // 2. Clear each ticker and settle. Total cash and shares must not change.
    const before = totals(accounts)
    for (const ticker of TICKERS) {
      const where = `batch ${batchId} ${ticker}`
      const orders = book.filter((o) => o.ticker === ticker)
      const res = clearBatch({ roundId: 'R', ticker, batchId, lastCents: last[ticker], orders })
      if (!same(res, clearBatch({ roundId: 'R', ticker, batchId, lastCents: last[ticker], orders }))) {
        v.fail(`${where}: same input gave a different ClearResult`)
      }
      if (orders.length > 0) checkClear(v, res, orders, last[ticker], where)
      const price = clearingPrice(orders, last[ticker])
      if (!same(price, res.clearCents === null ? null : { clearCents: res.clearCents, volume: res.volume })) {
        v.fail(`${where}: clearingPrice ${JSON.stringify(price)} disagrees with clearBatch`)
      }
      if (res.clearCents === null) continue
      stats.clears++
      const byId = new Map<string, BookOrder>()
      for (const o of orders) byId.set(o.orderId, o)
      for (const f of res.fills) {
        stats.fills++
        const o = byId.get(f.orderId)!
        accounts.set(f.traderId, settleFill(accounts.get(f.traderId)!, f, o.limitCents))
        o.remaining -= f.qty
      }
      last[ticker] = res.clearCents
    }
    book = book.filter((o) => o.remaining > 0)
    checkConserved(v, totals(accounts), before, `batch ${batchId} after clear`)
    checkAccounts(v, accounts, book, `batch ${batchId} after clear`)

    // 3. Some resting orders are cancelled.
    const keep: BookOrder[] = []
    for (const o of book) {
      if (rnd.next() < 0.08) accounts.set(o.traderId, releaseOrder(accounts.get(o.traderId)!, o))
      else keep.push(o)
    }
    book = keep
    checkConserved(v, totals(accounts), before, `batch ${batchId} after cancels`)
    checkAccounts(v, accounts, book, `batch ${batchId} after cancels`)
  }

  // Round end: release everything; nothing may stay reserved.
  const before = totals(accounts)
  for (const o of book) accounts.set(o.traderId, releaseOrder(accounts.get(o.traderId)!, o))
  checkAccounts(v, accounts, [], 'round end')
  checkConserved(v, totals(accounts), before, 'round end')
  return { stats, violations: v.list }
}

describe('property: seeded random order stream', () => {
  it('1,200 batches x 3 tickers keep money conserved and invariants intact (seed 1)', () => {
    const { stats, violations } = runStream(1, 1_200)
    expect(violations).toEqual([])
    // Make sure the stream actually exercised the engine.
    expect(stats.clears).toBeGreaterThan(500)
    expect(stats.fills).toBeGreaterThan(2_000)
    expect(stats.rejects).toBeGreaterThan(0)
  }, 60_000)

  it('a second seed (seed 20261121, 600 batches) also holds', () => {
    const { stats, violations } = runStream(20_261_121, 600)
    expect(violations).toEqual([])
    expect(stats.clears).toBeGreaterThan(200)
  }, 60_000)

  it('the whole stream is reproducible', () => {
    expect(runStream(7, 150)).toEqual(runStream(7, 150))
  }, 60_000)

  it('the checker itself catches broken output (guards against a silently passing harness)', () => {
    const v = new Violations()
    const orders: BookOrder[] = [
      { orderId: 'b', traderId: 'T0', ticker: 'ORBT', side: 'buy', limitCents: 105, remaining: 10, batchId: 1 },
      { orderId: 's', traderId: 'T1', ticker: 'ORBT', side: 'sell', limitCents: 100, remaining: 10, batchId: 1 },
    ]
    const good = clearBatch({ roundId: 'R', ticker: 'ORBT', batchId: 1, lastCents: 100, orders })
    checkClear(v, good, orders, 100, 'good')
    expect(v.list).toEqual([])
    // Under-filled: volume not maximal, book still crosses, not reproducible.
    const bad: ClearResult = {
      ...good,
      volume: 4,
      fills: good.fills.map((f) => ({ ...f, qty: 4 })),
    }
    checkClear(v, bad, orders, 100, 'bad')
    expect(v.list.some((m) => m.includes('not the maximum'))).toBe(true)
    expect(v.list.some((m) => m.includes('book crosses'))).toBe(true)
    expect(v.list.some((m) => m.includes('different ClearResult'))).toBe(true)
  })
})
