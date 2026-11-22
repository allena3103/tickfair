import { describe, expect, it } from 'vitest'
import { parsePlaceOrder } from './orders'

describe('parsePlaceOrder', () => {
  it('accepts a limit order and drops unknown fields such as userId', () => {
    expect(parsePlaceOrder({ ticker: 'ORBT', side: 'buy', type: 'limit', qty: 5, limitCents: 1234, userId: 'x' })).toEqual({
      ticker: 'ORBT', side: 'buy', type: 'limit', qty: 5, limitCents: 1234,
    })
  })

  it('accepts a market order without a limit', () => {
    expect(parsePlaceOrder({ ticker: 'VOLT', side: 'sell', type: 'market', qty: 1 })).toEqual({
      ticker: 'VOLT', side: 'sell', type: 'market', qty: 1,
    })
  })

  it.each([
    [{ ticker: 'AAPL', side: 'buy', type: 'limit', qty: 1, limitCents: 1 }, 'invalid_ticker'],
    [{ ticker: 'ORBT', side: 'buy', type: 'limit', qty: 0, limitCents: 1 }, 'invalid_qty'],
    [{ ticker: 'ORBT', side: 'buy', type: 'limit', qty: 1.5, limitCents: 1 }, 'invalid_qty'],
    [{ ticker: 'ORBT', side: 'buy', type: 'limit', qty: '3', limitCents: 1 }, 'invalid_qty'],
    [{ ticker: 'ORBT', side: 'hold', type: 'limit', qty: 1, limitCents: 1 }, 'invalid_side'],
    [{ ticker: 'ORBT', side: 'buy', type: 'limit', qty: 1 }, 'invalid_price'],
    [{ ticker: 'ORBT', side: 'buy', type: 'limit', qty: 1, limitCents: 10.5 }, 'invalid_price'],
    [{ ticker: 'ORBT', side: 'buy', type: 'stop', qty: 1, limitCents: 1 }, 'invalid_type'],
    [{ ticker: 'ORBT', side: 'buy', type: 'market', qty: 1, limitCents: 1 }, 'invalid_price'],
    [{ ticker: 'ORBT', type: 'limit', qty: 1, limitCents: 1 }, 'invalid_side'],
    [{ ticker: 'ORBT', side: 'buy', qty: 1, limitCents: 1 }, 'invalid_type'],
  ])('rejects %j with %s', (raw, code) => {
    expect(parsePlaceOrder(raw as Record<string, unknown>)).toBe(code)
  })
})
