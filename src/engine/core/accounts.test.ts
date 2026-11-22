import { describe, expect, it } from 'vitest'
import { MAX_OPEN_ORDERS, type Side } from '../../shared/contracts'
import {
  checkAndReserve,
  clearBatch,
  emptyAccount,
  marketLimit,
  priceBand,
  releaseOrder,
  settleFill,
  type Account,
  type BookOrder,
  type Fill,
} from './index'

const LAST = 1_000
function withShares(acct: Account, qty: number): Account {
  return { ...acct, holdings: { ...acct.holdings, ORBT: { qty, reservedQty: 0 } } }
}
function book(orderId: string, side: Side, remaining: number, limitCents: number): BookOrder {
  return { orderId, traderId: 't', ticker: 'ORBT', side, limitCents, remaining, batchId: 1 }
}
function reserveOk(acct: Account, side: Side, qty: number, limitCents: number, openOrders: BookOrder[] = []): Account {
  const r = checkAndReserve(acct, { side, ticker: 'ORBT', qty, limitCents }, { lastCents: LAST, openOrders })
  if (!r.ok) throw new Error(`unexpected reject ${r.code}`)
  return r.acct
}
function code(acct: Account, side: Side, qty: number, limitCents: number, openOrders: BookOrder[] = []) {
  const r = checkAndReserve(acct, { side, ticker: 'ORBT', qty, limitCents }, { lastCents: LAST, openOrders })
  return r.ok ? 'ok' : r.code
}

describe('price band and market orders', () => {
  it('band is ±10% of last, rounded inward', () => {
    expect(priceBand(1_000)).toEqual({ lo: 900, hi: 1_100 })
    expect(priceBand(1_001)).toEqual({ lo: 901, hi: 1_101 })
    expect(priceBand(1)).toEqual({ lo: 1, hi: 1 })
  })

  it('market orders are clamped to the band edge', () => {
    expect(marketLimit('buy', 1_000)).toBe(1_100)
    expect(marketLimit('sell', 1_000)).toBe(900)
    expect(marketLimit('buy', 1_001)).toBe(1_101)
    expect(marketLimit('sell', 1_001)).toBe(901)
  })

  it('a market buy reserves at the band top and clears at the uniform price', () => {
    const buyer = emptyAccount(1_000_000)
    const limit = marketLimit('buy', LAST)
    const reserved = reserveOk(buyer, 'buy', 10, limit)
    expect(reserved.reservedCents).toBe(11_000)
    const res = clearBatch({
      roundId: 'r',
      ticker: 'ORBT',
      batchId: 1,
      lastCents: LAST,
      orders: [book('mb', 'buy', 10, limit), book('ls', 'sell', 10, 1_000)],
    })
    expect(res.clearCents).toBe(1_000)
    const after = settleFill(reserved, res.fills[0], limit)
    expect(after).toEqual({ ...emptyAccount(1_000_000 - 10_000), holdings: { ...after.holdings, ORBT: { qty: 10, reservedQty: 0 } } })
  })

  it('rejects limits just outside the band, accepts the edges', () => {
    const a = emptyAccount(10_000_000)
    expect(code(a, 'buy', 1, 1_101)).toBe('outside_band')
    expect(code(a, 'buy', 1, 899)).toBe('outside_band')
    expect(code(a, 'buy', 1, 1_100)).toBe('ok')
    expect(code(a, 'buy', 1, 900)).toBe('ok')
  })
})

describe('checkAndReserve validation', () => {
  const a = withShares(emptyAccount(100_000), 50)

  it('qty must be an integer in 1..100000', () => {
    expect(code(a, 'buy', 0, 1_000)).toBe('invalid_qty')
    expect(code(a, 'buy', -1, 1_000)).toBe('invalid_qty')
    expect(code(a, 'buy', 1.5, 1_000)).toBe('invalid_qty')
    expect(code(a, 'buy', 100_001, 1_000)).toBe('invalid_qty')
    expect(code(a, 'buy', Number.NaN, 1_000)).toBe('invalid_qty')
    expect(code(emptyAccount(10_000_000_000), 'buy', 100_000, 1_000)).toBe('ok')
  })

  it('limit must be a positive integer', () => {
    expect(code(a, 'buy', 1, 0)).toBe('invalid_price')
    expect(code(a, 'buy', 1, -5)).toBe('invalid_price')
    expect(code(a, 'buy', 1, 1_000.5)).toBe('invalid_price')
    expect(code(a, 'buy', 1, Number.POSITIVE_INFINITY)).toBe('invalid_price')
  })

  it('rejects bad ticker and side values that slipped past typing', () => {
    const bad = (o: object) =>
      checkAndReserve(a, o as never, { lastCents: LAST, openOrders: [] })
    expect(bad({ side: 'buy', ticker: 'NOPE', qty: 1, limitCents: 1_000 })).toEqual({ ok: false, code: 'invalid_ticker' })
    expect(bad({ side: 'hold', ticker: 'ORBT', qty: 1, limitCents: 1_000 })).toEqual({ ok: false, code: 'invalid_side' })
  })

  it('cash and shares must cover the order', () => {
    expect(code(a, 'buy', 100, 1_000)).toBe('ok') // exactly 100_000
    expect(code(a, 'buy', 101, 1_000)).toBe('insufficient_cash')
    expect(code(a, 'sell', 50, 1_000)).toBe('ok')
    expect(code(a, 'sell', 51, 1_000)).toBe('insufficient_shares')
    const partlyReserved = reserveOk(a, 'sell', 30, 1_050)
    expect(code(partlyReserved, 'sell', 21, 1_050)).toBe('insufficient_shares')
    const cashReserved = reserveOk(a, 'buy', 60, 1_000)
    expect(code(cashReserved, 'buy', 41, 1_000)).toBe('insufficient_cash')
  })

  it('self_cross when the trader has a crossing opposite-side order on the same ticker', () => {
    const restingSell = book('s', 'sell', 5, 1_000)
    expect(code(a, 'buy', 1, 1_000, [restingSell])).toBe('self_cross')
    expect(code(a, 'buy', 1, 999, [restingSell])).toBe('ok')
    const restingBuy = book('b', 'buy', 5, 1_000)
    expect(code(a, 'sell', 1, 1_000, [restingBuy])).toBe('self_cross')
    expect(code(a, 'sell', 1, 1_001, [restingBuy])).toBe('ok')
    // Same side, other ticker, or fully filled: no self-cross.
    expect(code(a, 'buy', 1, 1_000, [book('b2', 'buy', 5, 1_100)])).toBe('ok')
    expect(code(a, 'buy', 1, 1_000, [{ ...restingSell, ticker: 'VOLT' }])).toBe('ok')
    expect(code(a, 'buy', 1, 1_000, [{ ...restingSell, remaining: 0 }])).toBe('ok')
  })

  it(`too_many_open at ${MAX_OPEN_ORDERS} open orders`, () => {
    const open = (k: number) => Array.from({ length: k }, (_, i) => book(`o${i}`, 'buy', 1, 950))
    expect(code(a, 'buy', 1, 1_000, open(MAX_OPEN_ORDERS - 1))).toBe('ok')
    expect(code(a, 'buy', 1, 1_000, open(MAX_OPEN_ORDERS))).toBe('too_many_open')
  })

  it('a rejection leaves the input account untouched and returns no account', () => {
    const before = structuredClone(a)
    const r = checkAndReserve(a, { side: 'buy', ticker: 'ORBT', qty: 1_000, limitCents: 1_000 }, { lastCents: LAST, openOrders: [] })
    expect(r).toEqual({ ok: false, code: 'insufficient_cash' })
    expect(a).toEqual(before)
  })
})

describe('reserve → settle → release round trips', () => {
  const fill = (side: Side, qty: number, priceCents: number): Fill => ({
    orderId: 'o',
    traderId: 't',
    ticker: 'ORBT',
    side,
    qty,
    priceCents,
    batchId: 1,
  })

  it('buy reserved at limit, filled below limit: buyer refunded the difference', () => {
    const start = emptyAccount(100_000)
    const r = reserveOk(start, 'buy', 10, 1_050)
    expect(r).toMatchObject({ cashCents: 89_500, reservedCents: 10_500 })
    const s = settleFill(r, fill('buy', 10, 1_000), 1_050)
    // paid 10 * 1000; refund 10 * 50 back to free cash
    expect(s).toMatchObject({ cashCents: 90_000, reservedCents: 0 })
    expect(s.holdings.ORBT).toEqual({ qty: 10, reservedQty: 0 })
    expect(r.cashCents).toBe(89_500) // input not mutated
  })

  it('partial buy fill, then cancel releases the rest', () => {
    const start = emptyAccount(100_000)
    const r = reserveOk(start, 'buy', 10, 1_050)
    const s = settleFill(r, fill('buy', 4, 1_020), 1_050)
    expect(s).toMatchObject({ cashCents: 89_500 + 4 * 30, reservedCents: 6 * 1_050 })
    const c = releaseOrder(s, book('o', 'buy', 6, 1_050))
    expect(c).toMatchObject({ cashCents: 100_000 - 4 * 1_020, reservedCents: 0 })
    expect(c.holdings.ORBT).toEqual({ qty: 4, reservedQty: 0 })
  })

  it('sell reserved, partly filled above limit, rest released', () => {
    const start = withShares(emptyAccount(0), 20)
    const r = reserveOk(start, 'sell', 15, 980)
    expect(r.holdings.ORBT).toEqual({ qty: 20, reservedQty: 15 })
    const s = settleFill(r, fill('sell', 10, 1_000), 980)
    expect(s.cashCents).toBe(10_000)
    expect(s.holdings.ORBT).toEqual({ qty: 10, reservedQty: 5 })
    const c = releaseOrder(s, book('o', 'sell', 5, 980))
    expect(c.holdings.ORBT).toEqual({ qty: 10, reservedQty: 0 })
    expect(c.reservedCents).toBe(0)
  })

  it('reserve then release with no fill is an exact no-op', () => {
    const start = withShares(emptyAccount(50_000), 7)
    const r1 = reserveOk(start, 'buy', 40, 1_000)
    const r2 = reserveOk(r1, 'sell', 7, 1_090)
    const back = releaseOrder(releaseOrder(r2, book('s', 'sell', 7, 1_090)), book('b', 'buy', 40, 1_000))
    expect(back).toEqual(start)
  })

  it('settle and release throw instead of breaking invariants', () => {
    const a = emptyAccount(10_000)
    expect(() => settleFill(a, fill('buy', 1, 1_000), 1_000)).toThrow(/reserved/)
    expect(() => settleFill(a, fill('sell', 1, 1_000), 1_000)).toThrow(/reserved/)
    const r = reserveOk(a, 'buy', 5, 1_000)
    expect(() => settleFill(r, fill('buy', 1, 1_001), 1_000)).toThrow(/above limit/)
    expect(() => settleFill(r, fill('buy', 0, 1_000), 1_000)).toThrow(/positive/)
    expect(() => releaseOrder(r, book('b', 'buy', 6, 1_000))).toThrow(/reserved/)
    expect(() => releaseOrder(a, book('s', 'sell', 1, 1_000))).toThrow(/reservedQty/)
    const sellR = reserveOk(withShares(a, 5), 'sell', 5, 1_000)
    expect(() => settleFill(sellR, fill('sell', 1, 999), 1_000)).toThrow(/below limit/)
  })
})
