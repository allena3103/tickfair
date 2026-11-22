/**
 * Frequent batch auction: how one batch of one ticker clears.
 *
 * Orders are collected for a short window (one batch). Arrival time inside the
 * window does not matter: everything in the batch is treated as simultaneous.
 * At the end of the window the engine finds one price for everybody.
 *
 * 1. Clearing price. Every limit price in the book is a candidate. For a
 *    candidate p, demand D(p) is the total buy quantity willing to pay p or more,
 *    and supply S(p) is the total sell quantity willing to accept p or less.
 *    The volume that can trade at p is V(p) = min(D(p), S(p)). The engine picks
 *    the p with the most volume. Ties go to the smallest imbalance |D - S|,
 *    then to the price closest to the last clearing price, then to the lower
 *    price. If nothing can trade, there is no clear.
 *
 * 2. Who fills. Everyone who trades pays or receives the same price p. On each
 *    side, better-priced orders fill first (higher bids, lower asks). Normally
 *    all orders priced strictly better than p fill in full and only the orders
 *    sitting exactly at p are rationed, on the side that has too much. Within
 *    a price level that cannot fill in full:
 *    - orders from earlier batches go first (resting orders keep time priority);
 *    - orders from the same batch share pro-rata by remaining quantity, rounded
 *      down to whole shares, and the few leftover shares go to the largest
 *      fractional remainders;
 *    - if remainders tie, the order with the lowest sha256(seed + orderId) wins.
 *
 *    (Rare case: when the tie-breaks pick a p where strictly-better orders
 *    alone exceed the other side, the marginal level is that better price, and
 *    it is rationed by the same rules. Price priority is never broken.)
 *
 * 3. The seed is SHA-256 of roundId|ticker|batchId|sorted orderIds. All inputs
 *    are server-generated and the seed is published on the tape, so anyone can
 *    recompute the allocation. Nothing here depends on input order or on time.
 */
import type { Side, Ticker } from '../../shared/contracts'
import { batchSeed, tiebreakKey } from './seed'
import type { BookOrder, ClearResult, Fill } from './types'

/**
 * The uniform clearing price for a set of orders of one ticker, or null if no
 * buy and sell cross. Orders with `remaining <= 0` are ignored.
 */
export function clearingPrice(
  orders: BookOrder[],
  lastCents: number,
): { clearCents: number; volume: number } | null {
  const live = orders.filter((o) => o.remaining > 0)
  const candidates = [...new Set(live.map((o) => o.limitCents))]

  let best: { p: number; v: number; imbalance: number; dist: number } | null = null
  for (const p of candidates) {
    let d = 0
    let s = 0
    for (const o of live) {
      if (o.side === 'buy' && o.limitCents >= p) d += o.remaining
      else if (o.side === 'sell' && o.limitCents <= p) s += o.remaining
    }
    const v = Math.min(d, s)
    if (v <= 0) continue
    const cand = { p, v, imbalance: Math.abs(d - s), dist: Math.abs(p - lastCents) }
    if (best === null || better(cand, best)) best = cand
  }
  return best === null ? null : { clearCents: best.p, volume: best.v }
}

type Candidate = { p: number; v: number; imbalance: number; dist: number }

function better(a: Candidate, b: Candidate): boolean {
  if (a.v !== b.v) return a.v > b.v
  if (a.imbalance !== b.imbalance) return a.imbalance < b.imbalance
  if (a.dist !== b.dist) return a.dist < b.dist
  return a.p < b.p
}

/**
 * Clear one batch of one ticker. `orders` is the whole book for that ticker
 * (resting orders from earlier batches plus this batch's arrivals). Every
 * order must be for `input.ticker` and have a non-negative integer `remaining`;
 * anything else is a programming error and throws.
 *
 * Fills are returned sorted by side (buys first), then by orderId, so the
 * result does not depend on the order of the input array.
 */
export function clearBatch(input: {
  roundId: string
  ticker: Ticker
  batchId: number
  lastCents: number
  orders: BookOrder[]
}): ClearResult {
  const { roundId, ticker, batchId, lastCents, orders } = input
  const seen = new Set<string>()
  for (const o of orders) {
    if (o.ticker !== ticker) throw new Error(`clearBatch: order ${o.orderId} is for ${o.ticker}, not ${ticker}`)
    if (!Number.isSafeInteger(o.remaining) || o.remaining < 0) {
      throw new Error(`clearBatch: order ${o.orderId} has invalid remaining ${o.remaining}`)
    }
    if (!Number.isSafeInteger(o.limitCents) || o.limitCents <= 0) {
      throw new Error(`clearBatch: order ${o.orderId} has invalid limit ${o.limitCents}`)
    }
    if (seen.has(o.orderId)) throw new Error(`clearBatch: duplicate orderId ${o.orderId}`)
    seen.add(o.orderId)
  }

  const seed = batchSeed(
    roundId,
    ticker,
    batchId,
    orders.map((o) => o.orderId),
  )
  const cleared = clearingPrice(orders, lastCents)
  if (cleared === null) return { ticker, batchId, clearCents: null, volume: 0, seed, fills: [] }

  const { clearCents, volume } = cleared
  const live = orders.filter((o) => o.remaining > 0)
  const buys = live.filter((o) => o.side === 'buy' && o.limitCents >= clearCents)
  const sells = live.filter((o) => o.side === 'sell' && o.limitCents <= clearCents)

  const fills: Fill[] = []
  for (const [side, eligible] of [
    ['buy', buys],
    ['sell', sells],
  ] as const) {
    const alloc = allocateSide(side, eligible, volume, seed)
    for (const o of eligible) {
      const qty = alloc.get(o.orderId) ?? 0
      if (qty > 0) {
        fills.push({ orderId: o.orderId, traderId: o.traderId, ticker, side, qty, priceCents: clearCents, batchId })
      }
    }
  }
  fills.sort((a, b) => (a.side === b.side ? cmp(a.orderId, b.orderId) : a.side === 'buy' ? -1 : 1))
  return { ticker, batchId, clearCents, volume, seed, fills }
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Hand out `volume` shares to one side's eligible orders by price priority,
 * then batch priority, then pro-rata with largest remainder. The caller
 * guarantees the eligible quantity is at least `volume`.
 */
function allocateSide(side: Side, eligible: BookOrder[], volume: number, seed: string): Map<string, number> {
  const alloc = new Map<string, number>()
  // Group into price levels, best first, then into batches inside a level, earliest first.
  const levels = groupBy(eligible, (o) => o.limitCents).sort((a, b) =>
    side === 'buy' ? b.key - a.key : a.key - b.key,
  )
  let left = volume
  for (const level of levels) {
    const batches = groupBy(level.items, (o) => o.batchId).sort((a, b) => a.key - b.key)
    for (const group of batches) {
      if (left === 0) return alloc
      const total = sum(group.items.map((o) => o.remaining))
      if (total <= left) {
        for (const o of group.items) alloc.set(o.orderId, o.remaining)
        left -= total
      } else {
        for (const [id, q] of proRata(group.items, left, seed)) alloc.set(id, q)
        left = 0
      }
    }
  }
  if (left !== 0) throw new Error(`allocateSide: ${left} shares left unallocated on ${side} side`)
  return alloc
}

/**
 * Split `cap` shares (cap < total remaining) across orders in proportion to
 * `remaining`. Each order gets floor(cap * r / total). The leftover shares go,
 * one each, to the largest fractional parts; equal fractions are broken by the
 * lowest sha256(seed + orderId). Exact integer arithmetic throughout.
 */
function proRata(orders: BookOrder[], cap: number, seed: string): Map<string, number> {
  const total = sum(orders.map((o) => o.remaining))
  const rows = orders.map((o) => {
    // BigInt keeps cap * remaining exact even for very large books.
    const num = BigInt(cap) * BigInt(o.remaining)
    const T = BigInt(total)
    return { o, base: Number(num / T), frac: num % T, key: tiebreakKey(seed, o.orderId) }
  })
  let leftover = cap - sum(rows.map((r) => r.base))
  rows.sort((a, b) => (a.frac === b.frac ? cmp(a.key, b.key) : a.frac > b.frac ? -1 : 1))
  const out = new Map<string, number>()
  for (const r of rows) {
    const extra = leftover > 0 ? 1 : 0
    leftover -= extra
    out.set(r.o.orderId, r.base + extra)
  }
  return out
}

function groupBy<K extends number>(items: BookOrder[], keyOf: (o: BookOrder) => K): { key: K; items: BookOrder[] }[] {
  const map = new Map<K, BookOrder[]>()
  for (const o of items) {
    const k = keyOf(o)
    const list = map.get(k)
    if (list) list.push(o)
    else map.set(k, [o])
  }
  return [...map.entries()].map(([key, list]) => ({ key, items: list }))
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0)
}
