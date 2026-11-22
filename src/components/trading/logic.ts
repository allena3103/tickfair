/**
 * Pure helpers for the trading terminal: reserve math, positions, reject
 * messages, and chart points. No React, no I/O, so they are unit-tested.
 *
 * Money is integer cents, quantity is whole shares (src/shared/contracts.ts).
 */

import { priceBand } from '@/engine/core'
import {
  START_CASH_CENTS,
  TICKERS,
  type OrderRecord,
  type OrderType,
  type PortfolioRecord,
  type Print,
  type RejectCode,
  type Side,
  type TapeRecord,
  type Ticker,
} from '@/shared/contracts'

export const LIVE_ORDER_STATUSES = new Set(['open', 'partial'])

export function isLiveOrder(o: Pick<OrderRecord, 'status'>): boolean {
  return LIVE_ORDER_STATUSES.has(o.status)
}

/** Shares still waiting to fill on an order. */
export function remainingQty(o: Pick<OrderRecord, 'qty' | 'filledQty'>): number {
  return Math.max(0, (o.qty ?? 0) - (o.filledQty ?? 0))
}

/**
 * What the exchange holds while an order rests (LESSONS 14/23):
 * buys hold remaining × limit in cash, sells hold the remaining shares.
 */
export function reservedBy(orders: OrderRecord[]): { cashCents: number; shares: Record<Ticker, number> } {
  const shares = emptyHoldings()
  let cashCents = 0
  for (const o of orders) {
    if (!isLiveOrder(o)) continue
    const rem = remainingQty(o)
    if (o.side === 'buy') cashCents += rem * (o.limitCents ?? 0)
    else if (o.ticker in shares) shares[o.ticker] += rem
  }
  return { cashCents, shares }
}

export function emptyHoldings(): Record<Ticker, number> {
  return Object.fromEntries(TICKERS.map((t) => [t, 0])) as Record<Ticker, number>
}

/** Holdings arrive as JSON; be defensive about strings and missing tickers. */
export function readHoldings(raw: unknown): Record<Ticker, number> {
  let v: unknown = raw
  if (typeof raw === 'string') {
    try {
      v = JSON.parse(raw)
    } catch {
      v = null
    }
  }
  const out = emptyHoldings()
  if (v && typeof v === 'object') {
    for (const t of TICKERS) {
      const n = Number((v as Record<string, unknown>)[t])
      if (Number.isFinite(n)) out[t] = n
    }
  }
  return out
}

export interface TicketInput {
  side: Side
  type: OrderType
  qty: number
  /** Limit price in cents; ignored for market orders. */
  limitCents: number | null
  /** Last clearing price in cents, for the market-order band edge. */
  lastCents: number | null
}

/**
 * The cash (buy) or shares (sell) this order would reserve. A market buy is
 * reserved at the band's top edge, exactly like the engine (`marketLimit`).
 * Returns null when the inputs are not a valid order yet.
 */
export function ticketReserve(t: TicketInput): { kind: 'cash'; cents: number; priceCents: number } | { kind: 'shares'; qty: number } | null {
  if (!Number.isSafeInteger(t.qty) || t.qty <= 0) return null
  if (t.side === 'sell') return { kind: 'shares', qty: t.qty }
  let price: number | null
  if (t.type === 'limit') price = t.limitCents
  else price = t.lastCents && t.lastCents > 0 ? priceBand(t.lastCents).hi : null
  if (!price || !Number.isSafeInteger(price) || price <= 0) return null
  return { kind: 'cash', cents: price * t.qty, priceCents: price }
}

/** "42.10" / "42.1" / "42" → 4210 cents; anything else → null. */
export function parsePriceInput(raw: string): number | null {
  const s = raw.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  const [whole, frac = ''] = s.split('.')
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'))
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null
}

/** Whole positive shares only. */
export function parseQtyInput(raw: string): number | null {
  const s = raw.trim()
  if (!/^\d+$/.test(s)) return null
  const n = Number(s)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

/** Plain-language text for every reject code. */
export const REJECT_MESSAGES: Record<RejectCode, string> = {
  round_closed: 'The round is closed. Orders open again next round.',
  invalid_ticker: 'That stock does not exist.',
  invalid_side: 'Choose buy or sell.',
  invalid_type: 'Choose limit or market.',
  invalid_qty: 'Enter a whole number of shares, up to 100,000.',
  invalid_price: 'Enter a limit price above zero, in dollars and cents.',
  outside_band: 'Your price is more than 10% from the last trade.',
  insufficient_cash: 'You do not have enough free cash for this order.',
  insufficient_shares: 'You do not have enough free shares to sell.',
  self_cross: 'This order would trade against your own open order.',
  rate_limited: 'Too many orders this second. Try again next batch.',
  too_many_open: 'You have 20 open orders. Cancel one first.',
  not_found: 'That order no longer exists.',
  not_owner: 'That order is not yours.',
  already_final: 'That order already filled or was cancelled.',
  forbidden: 'You cannot trade from this account.',
}

export function rejectMessage(code: unknown): string {
  if (typeof code === 'string' && code in REJECT_MESSAGES) return REJECT_MESSAGES[code as RejectCode]
  return 'The exchange did not accept that. Try again.'
}

export interface PositionRow {
  ticker: Ticker
  qty: number
  lastCents: number | null
  valueCents: number
}

export interface PortfolioView {
  cashCents: number
  freeCashCents: number
  rows: PositionRow[]
  equityCents: number
  pnlCents: number
}

/**
 * My portfolio marked to `last`. Without a portfolio record yet (no order
 * this round), you hold the starting cash and nothing else.
 */
export function portfolioView(
  p: Pick<PortfolioRecord, 'cashCents' | 'holdings'> | null,
  last: Partial<Record<Ticker, number>>,
  openOrders: OrderRecord[],
): PortfolioView {
  const cashCents = p ? Number(p.cashCents) || 0 : START_CASH_CENTS
  const holdings = p ? readHoldings(p.holdings) : emptyHoldings()
  const reserved = reservedBy(openOrders)
  const rows = TICKERS.map((ticker) => {
    const px = last[ticker]
    const lastCents = typeof px === 'number' && px > 0 ? px : null
    const qty = holdings[ticker]
    return { ticker, qty, lastCents, valueCents: lastCents === null ? 0 : qty * lastCents }
  })
  const equityCents = cashCents + rows.reduce((s, r) => s + r.valueCents, 0)
  return {
    cashCents,
    freeCashCents: Math.max(0, cashCents - reserved.cashCents),
    rows,
    equityCents,
    pnlCents: equityCents - START_CASH_CENTS,
  }
}

export interface ChartPoint {
  batchId: number
  priceCents: number
}

/**
 * One price per batch for one ticker and round: stored tape history merged
 * with live prints from the socket (a print wins over nothing, tape wins on
 * a tie since both carry the same clearing price). Oldest first.
 */
export function chartPoints(
  tape: Pick<TapeRecord, 'ticker' | 'roundId' | 'batchId' | 'clearCents'>[],
  prints: Pick<Print, 'ticker' | 'roundId' | 'batchId' | 'clearCents'>[],
  ticker: Ticker,
  roundId: string,
  max = 300,
): ChartPoint[] {
  const byBatch = new Map<number, number>()
  for (const p of prints) {
    if (p.ticker === ticker && p.roundId === roundId && Number.isFinite(p.clearCents)) byBatch.set(p.batchId, p.clearCents)
  }
  for (const t of tape) {
    if (t.ticker === ticker && t.roundId === roundId && Number.isFinite(t.clearCents)) byBatch.set(t.batchId, t.clearCents)
  }
  return [...byBatch.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(-max)
    .map(([batchId, priceCents]) => ({ batchId, priceCents }))
}

/** SVG polyline path for points in a w×h box, with a little vertical padding. */
export function linePath(points: ChartPoint[], w: number, h: number, pad = 8): { d: string; lo: number; hi: number } | null {
  if (points.length === 0) return null
  let lo = Infinity
  let hi = -Infinity
  for (const p of points) {
    lo = Math.min(lo, p.priceCents)
    hi = Math.max(hi, p.priceCents)
  }
  // Keep a flat line in the middle rather than dividing by zero.
  const span = hi - lo || Math.max(1, Math.round(hi * 0.002))
  const mid = (hi + lo) / 2
  const top = hi === lo ? mid + span / 2 : hi
  const bottom = hi === lo ? mid - span / 2 : lo
  const n = points.length
  const x = (i: number) => (n === 1 ? w : (i / (n - 1)) * w)
  const y = (c: number) => pad + (1 - (c - bottom) / (top - bottom)) * (h - pad * 2)
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.priceCents).toFixed(1)}`).join(' ')
  return { d, lo, hi }
}

/** Ladder rows: asks best (lowest) nearest the spread, so asks render high→low over bids high→low. */
export function ladderRows(depth: { bids: [number, number][]; asks: [number, number][] } | undefined, levels = 8) {
  const asks = [...(depth?.asks ?? [])].sort((a, b) => a[0] - b[0]).slice(0, levels).reverse()
  const bids = [...(depth?.bids ?? [])].sort((a, b) => b[0] - a[0]).slice(0, levels)
  const maxQty = Math.max(1, ...asks.map((l) => l[1]), ...bids.map((l) => l[1]))
  const bestAsk = asks.length ? asks[asks.length - 1][0] : null
  const bestBid = bids.length ? bids[0][0] : null
  return { asks, bids, maxQty, spreadCents: bestAsk !== null && bestBid !== null ? bestAsk - bestBid : null }
}
