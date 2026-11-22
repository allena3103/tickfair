import { describe, expect, it } from 'vitest'
import { MAX_LIMIT_CENTS, parseCancel, parsePlaceOrder } from './orders'
import { MAX_ORDER_QTY } from '../engine/core'

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
    [{ ticker: 'ORBT', side: 'buy', type: 'limit', qty: MAX_ORDER_QTY + 1, limitCents: 1 }, 'invalid_qty'],
    [{ ticker: 'ORBT', side: 'buy', type: 'limit', qty: -1, limitCents: 1 }, 'invalid_qty'],
    [{ ticker: 'ORBT', side: 'buy', type: 'limit', qty: 1, limitCents: MAX_LIMIT_CENTS + 1 }, 'invalid_price'],
    [{ ticker: 'ORBT', side: 'buy', type: 'limit', qty: 1, limitCents: -5 }, 'invalid_price'],
    [{ ticker: 'ORBT', side: 'buy', type: 'limit', qty: Infinity, limitCents: 5 }, 'invalid_qty'],
  ])('rejects %j with %s', (raw, code) => {
    expect(parsePlaceOrder(raw as Record<string, unknown>)).toBe(code)
  })
})

describe('parsePlaceOrder input shape', () => {
  it.each([null, [], 'x', 3])('rejects non-object params %j', (raw) => {
    expect(parsePlaceOrder(raw)).toBe('invalid_ticker')
  })
})

describe('parseCancel', () => {
  it('accepts a server-shaped order id', () => {
    expect(parseCancel({ orderId: 'o-0f8b6c1e-2d3a-4b5c-8d9e-0a1b2c3d4e5f' })).toBe('o-0f8b6c1e-2d3a-4b5c-8d9e-0a1b2c3d4e5f')
  })
  it.each([null, {}, { orderId: 5 }, { orderId: '' }, { orderId: 'o-x' }, { orderId: 'x'.repeat(500) }])('rejects %j', (raw) => {
    expect(parseCancel(raw)).toBeNull()
  })
})
