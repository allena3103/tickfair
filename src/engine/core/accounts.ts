/**
 * Reservations and settlement. Every function is pure and returns a new Account.
 *
 * A buy reserves qty * limit cents (moved from free cash into reservedCents).
 * A sell reserves qty shares (counted in reservedQty). When the order fills,
 * the reservation for the filled part is consumed; a buyer who paid less than
 * the limit gets the difference back as free cash. Cancelling or ending the
 * round releases whatever is still reserved for the unfilled part.
 *
 * checkAndReserve returns a reject code for bad user input. settleFill and
 * releaseOrder throw if they would break an invariant: that means the caller
 * has a bug, and the surrounding transaction must roll back.
 */
import {
  MAX_OPEN_ORDERS,
  PRICE_BAND_BPS,
  TICKERS,
  type RejectCode,
  type Side,
  type Ticker,
} from '../../shared/contracts'
import type { Account, BookOrder, Fill } from './types'

export const MAX_ORDER_QTY = 100_000

const BPS = 10_000

/** A fresh account with `cashCents` free cash and no shares. */
export function emptyAccount(cashCents: number): Account {
  const holdings = {} as Account['holdings']
  for (const t of TICKERS) holdings[t] = { qty: 0, reservedQty: 0 }
  return { cashCents, reservedCents: 0, holdings }
}

/**
 * The INCLUSIVE band of allowed limits: lo <= limit <= hi.
 * The exact edges last * (1 ± PRICE_BAND_BPS/10000) are inside. When an edge is
 * not a whole cent, it rounds inward (lo up, hi down) to the nearest whole cent
 * that is still inside. Exact integer arithmetic, no floating point.
 * Callers (market-sim bots, the runtime) should take edges from here or from
 * marketLimit rather than computing them, so they always agree with the check.
 */
export function priceBand(lastCents: number): { lo: number; hi: number } {
  assertPositiveInt(lastCents, 'lastCents')
  const lo = Math.max(1, ceilDiv(lastCents * (BPS - PRICE_BAND_BPS), BPS))
  const hi = floorDiv(lastCents * (BPS + PRICE_BAND_BPS), BPS)
  return { lo, hi }
}

/** floor(n / d) for non-negative safe integers, without float division. */
function floorDiv(n: number, d: number): number {
  return (n - (n % d)) / d
}

/** ceil(n / d) for non-negative safe integers, without float division. */
function ceilDiv(n: number, d: number): number {
  const r = n % d
  return (n - r) / d + (r === 0 ? 0 : 1)
}

/** A market order is a limit order at the band edge: the top for buys, the bottom for sells. */
export function marketLimit(side: Side, lastCents: number): number {
  const { lo, hi } = priceBand(lastCents)
  return side === 'buy' ? hi : lo
}

/**
 * Validate a new order and reserve cash or shares for it.
 * `ctx.openOrders` is this trader's open orders across all tickers.
 * Checks run in this order: ticker, side, qty, price, band, open-order cap,
 * self-cross, then funds.
 */
export function checkAndReserve(
  acct: Account,
  order: { side: Side; ticker: Ticker; qty: number; limitCents: number },
  ctx: { lastCents: number; openOrders: BookOrder[] },
): { ok: true; acct: Account } | { ok: false; code: RejectCode } {
  const { side, ticker, qty, limitCents } = order
  if (!(TICKERS as readonly string[]).includes(ticker)) return reject('invalid_ticker')
  if (side !== 'buy' && side !== 'sell') return reject('invalid_side')
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_ORDER_QTY) return reject('invalid_qty')
  if (!Number.isSafeInteger(limitCents) || limitCents < 1) return reject('invalid_price')

  const { lo, hi } = priceBand(ctx.lastCents)
  if (limitCents < lo || limitCents > hi) return reject('outside_band')

  const open = ctx.openOrders.filter((o) => o.remaining > 0)
  if (open.length >= MAX_OPEN_ORDERS) return reject('too_many_open')

  const crosses = open.some(
    (o) =>
      o.ticker === ticker &&
      o.side !== side &&
      (side === 'buy' ? limitCents >= o.limitCents : limitCents <= o.limitCents),
  )
  if (crosses) return reject('self_cross')

  const next = cloneAccount(acct)
  if (side === 'buy') {
    const cost = qty * limitCents
    if (next.cashCents < cost) return reject('insufficient_cash')
    next.cashCents -= cost
    next.reservedCents += cost
  } else {
    const h = next.holdings[ticker]
    if (h.qty - h.reservedQty < qty) return reject('insufficient_shares')
    h.reservedQty += qty
  }
  return { ok: true, acct: next }
}

/**
 * Apply one fill. `orderLimitCents` is the limit the order reserved at.
 * Buyer: consume qty * limit of reservation, refund qty * (limit - price), add shares.
 * Seller: consume qty reserved shares, remove them, add qty * price cash.
 */
export function settleFill(acct: Account, fill: Fill, orderLimitCents: number): Account {
  const { side, ticker, qty, priceCents } = fill
  assertPositiveInt(qty, 'fill.qty')
  assertPositiveInt(priceCents, 'fill.priceCents')
  assertPositiveInt(orderLimitCents, 'orderLimitCents')
  const next = cloneAccount(acct)
  const h = next.holdings[ticker]
  if (side === 'buy') {
    if (priceCents > orderLimitCents) throw new Error(`settleFill: buy price ${priceCents} above limit ${orderLimitCents}`)
    const held = qty * orderLimitCents
    if (next.reservedCents < held) throw new Error(`settleFill: reserved ${next.reservedCents} < ${held}`)
    next.reservedCents -= held
    next.cashCents += qty * (orderLimitCents - priceCents)
    h.qty += qty
  } else {
    if (priceCents < orderLimitCents) throw new Error(`settleFill: sell price ${priceCents} below limit ${orderLimitCents}`)
    if (h.reservedQty < qty || h.qty < qty) throw new Error(`settleFill: not enough reserved ${ticker} shares`)
    h.reservedQty -= qty
    h.qty -= qty
    next.cashCents += qty * priceCents
  }
  return next
}

/** Release the reservation for an order's unfilled `remaining` (cancel or round end). */
export function releaseOrder(acct: Account, order: BookOrder): Account {
  const { side, ticker, remaining, limitCents } = order
  if (!Number.isInteger(remaining) || remaining < 0) throw new Error(`releaseOrder: invalid remaining ${remaining}`)
  const next = cloneAccount(acct)
  if (side === 'buy') {
    const held = remaining * limitCents
    if (next.reservedCents < held) throw new Error(`releaseOrder: reserved ${next.reservedCents} < ${held}`)
    next.reservedCents -= held
    next.cashCents += held
  } else {
    const h = next.holdings[ticker]
    if (h.reservedQty < remaining) throw new Error(`releaseOrder: reservedQty ${h.reservedQty} < ${remaining}`)
    h.reservedQty -= remaining
  }
  return next
}

function cloneAccount(a: Account): Account {
  const holdings = {} as Account['holdings']
  for (const t of TICKERS) {
    const h = a.holdings[t] ?? { qty: 0, reservedQty: 0 }
    holdings[t] = { qty: h.qty, reservedQty: h.reservedQty }
  }
  return { cashCents: a.cashCents, reservedCents: a.reservedCents, holdings }
}

function reject(code: RejectCode): { ok: false; code: RejectCode } {
  return { ok: false, code }
}

function assertPositiveInt(n: number, name: string): void {
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`${name} must be a positive integer, got ${n}`)
}
