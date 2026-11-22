import { describe, expect, it } from 'vitest'
import type { Side } from '../../shared/contracts'
import { batchSeed, clearBatch, clearingPrice, type BookOrder } from './index'

function ord(orderId: string, side: Side, remaining: number, limitCents: number, batchId = 1, traderId = `t-${orderId}`): BookOrder {
  return { orderId, traderId, ticker: 'ORBT', side, limitCents, remaining, batchId }
}
function clear(orders: BookOrder[], lastCents = 100, batchId = 1, roundId = 'r1') {
  return clearBatch({ roundId, ticker: 'ORBT', batchId, lastCents, orders })
}
function qtyOf(res: ReturnType<typeof clear>): Record<string, number> {
  return Object.fromEntries(res.fills.map((f) => [f.orderId, f.qty]))
}

describe('batchSeed', () => {
  it('is hex sha256 of roundId|ticker|batchId|sorted ids (value checked with node:crypto)', () => {
    // node -e "crypto.createHash('sha256').update('r1|ORBT|5|b1,s1,s2').digest('hex')"
    expect(batchSeed('r1', 'ORBT', 5, ['s2', 'b1', 's1'])).toBe(
      '532342c578c5b22e73b84234a46b499d405dc4658eb0fe6f7c669d585b076700',
    )
  })
})

describe('clearingPrice', () => {
  it('simple cross: everyone trades at one price', () => {
    const res = clear([ord('b', 'buy', 10, 105), ord('s', 'sell', 10, 100)], 100)
    expect(res.clearCents).toBe(100)
    expect(res.volume).toBe(10)
    expect(res.fills).toEqual([
      { orderId: 'b', traderId: 't-b', ticker: 'ORBT', side: 'buy', qty: 10, priceCents: 100, batchId: 1 },
      { orderId: 's', traderId: 't-s', ticker: 'ORBT', side: 'sell', qty: 10, priceCents: 100, batchId: 1 },
    ])
  })

  it('no cross: null price, no fills, seed still published', () => {
    const res = clear([ord('b', 'buy', 10, 99), ord('s', 'sell', 10, 100)])
    expect(res.clearCents).toBeNull()
    expect(res.volume).toBe(0)
    expect(res.fills).toEqual([])
    expect(res.seed).toMatch(/^[0-9a-f]{64}$/)
    expect(clearingPrice([ord('b', 'buy', 10, 99), ord('s', 'sell', 10, 100)], 100)).toBeNull()
  })

  it('empty book and one-sided book do not clear', () => {
    expect(clearingPrice([], 100)).toBeNull()
    expect(clearingPrice([ord('b', 'buy', 5, 100), ord('b2', 'buy', 5, 101)], 100)).toBeNull()
  })

  it('ignores orders with zero remaining', () => {
    expect(clearingPrice([ord('b', 'buy', 0, 105), ord('s', 'sell', 10, 100)], 100)).toBeNull()
  })

  it('tie-break 1: maximum volume wins', () => {
    // p=100: D=8 S=3 V=3 ; p=101: D=5 S=8 V=5 -> 101
    const orders = [ord('b1', 'buy', 5, 101), ord('b2', 'buy', 3, 100), ord('s1', 'sell', 3, 100), ord('s2', 'sell', 5, 101)]
    expect(clearingPrice(orders, 100)).toEqual({ clearCents: 101, volume: 5 })
  })

  it('tie-break 2: equal volume, smaller |D-S| wins even if further from last', () => {
    // p=100: D=8 S=5 V=5 |D-S|=3 ; p=101: D=5 S=5 V=5 |D-S|=0 -> 101
    const orders = [ord('b1', 'buy', 5, 101), ord('b2', 'buy', 3, 100), ord('s1', 'sell', 5, 100)]
    expect(clearingPrice(orders, 100)).toEqual({ clearCents: 101, volume: 5 })
  })

  it('tie-break 3: equal volume and imbalance, closest to last wins', () => {
    // p=100 and p=105 both V=10 |D-S|=0
    const orders = [ord('b', 'buy', 10, 105), ord('s', 'sell', 10, 100)]
    expect(clearingPrice(orders, 100)?.clearCents).toBe(100)
    expect(clearingPrice(orders, 105)?.clearCents).toBe(105)
    expect(clearingPrice(orders, 104)?.clearCents).toBe(105)
  })

  it('tie-break 4: all equal, lower price wins', () => {
    const orders = [ord('b', 'buy', 10, 104), ord('s', 'sell', 10, 100)]
    expect(clearingPrice(orders, 102)?.clearCents).toBe(100)
  })
})

describe('allocation', () => {
  it('orders strictly better than p fill in full; rationing is at p', () => {
    // p=100 (V=7). Buy at 110 fills 5 in full; buy at 100 gets the other 2.
    const res = clear([ord('b1', 'buy', 5, 110), ord('b2', 'buy', 5, 100), ord('s', 'sell', 7, 100)])
    expect(res.clearCents).toBe(100)
    expect(qtyOf(res)).toEqual({ b1: 5, b2: 2, s: 7 })
  })

  it('one buyer vs two identical simultaneous sellers: even split', () => {
    const res = clear([ord('b', 'buy', 10, 100), ord('s1', 'sell', 10, 100), ord('s2', 'sell', 10, 100)])
    expect(qtyOf(res)).toEqual({ b: 10, s1: 5, s2: 5 })
  })

  it('3 shares across 2 equal orders: 1 each, leftover to lowest sha256(seed+orderId)', () => {
    // seed = sha256('r1|ORBT|5|b1,s1,s2') = 532342c5...6700
    // sha256(seed+'s1') = d4f1f737...  sha256(seed+'s2') = a2bbaa76...  -> s2 is lower, gets the leftover.
    const res = clear(
      [ord('b1', 'buy', 3, 100, 5), ord('s1', 'sell', 2, 100, 5), ord('s2', 'sell', 2, 100, 5)],
      100,
      5,
    )
    expect(res.seed).toBe('532342c578c5b22e73b84234a46b499d405dc4658eb0fe6f7c669d585b076700')
    expect(qtyOf(res)).toEqual({ b1: 3, s1: 1, s2: 2 })
  })

  it('largest remainder beats the hash tiebreak', () => {
    // 5 shares across sells of 4 and 2: exact shares 3.33 and 1.67 -> 3 and 1, leftover to c (bigger fraction).
    const res = clear([ord('a', 'buy', 5, 100), ord('b', 'sell', 4, 100), ord('c', 'sell', 2, 100)])
    expect(qtyOf(res)).toEqual({ a: 5, b: 3, c: 2 })
  })

  it('an earlier batch beats a later one at the same price', () => {
    const res = clear(
      [ord('s_new', 'sell', 5, 100, 2), ord('s_old', 'sell', 5, 100, 1), ord('b', 'buy', 5, 100, 2)],
      100,
      2,
    )
    expect(qtyOf(res)).toEqual({ b: 5, s_old: 5 })
  })

  it('earlier batch fills in full, then the later batch is pro-rated', () => {
    const res = clear(
      [ord('old', 'sell', 4, 100, 1), ord('n1', 'sell', 6, 100, 3), ord('n2', 'sell', 6, 100, 3), ord('b', 'buy', 10, 100, 3)],
      100,
      3,
    )
    expect(qtyOf(res)).toEqual({ b: 10, old: 4, n1: 3, n2: 3 })
  })

  it('better price beats earlier batch', () => {
    const res = clear(
      [ord('early', 'sell', 5, 100, 1), ord('cheap', 'sell', 5, 99, 2), ord('b', 'buy', 5, 100, 2)],
      100,
      2,
    )
    expect(res.clearCents).toBe(99)
    expect(qtyOf(res)).toEqual({ b: 5, cheap: 5 })
  })

  it('rare case: tie-breaks pick p where strictly-better orders exceed the other side; price priority still holds', () => {
    // p=100 and p=105 both V=5 |D-S|=5; closest to last=100 -> p=100. Both buys are at 105 (> p)
    // and together want 10, so they are rationed pro-rata at their own level: 6:4 of 5 -> 3 and 2.
    const res = clear([ord('x', 'buy', 6, 105), ord('y', 'buy', 4, 105), ord('s', 'sell', 5, 100)], 100)
    expect(res.clearCents).toBe(100)
    expect(qtyOf(res)).toEqual({ x: 3, y: 2, s: 5 })
  })

  it('all fills share the clearing price and the clearing batchId', () => {
    const res = clear(
      [ord('b1', 'buy', 5, 110, 1), ord('b2', 'buy', 5, 101, 2), ord('s1', 'sell', 3, 95, 1), ord('s2', 'sell', 6, 100, 2)],
      100,
      7,
    )
    expect(new Set(res.fills.map((f) => f.priceCents))).toEqual(new Set([res.clearCents]))
    expect(res.fills.every((f) => f.batchId === 7)).toBe(true)
  })

  it('rejects malformed input loudly', () => {
    expect(() => clear([{ ...ord('a', 'buy', 1, 100), ticker: 'VOLT' }])).toThrow(/not ORBT/)
    expect(() => clear([ord('a', 'buy', 1.5, 100)])).toThrow(/remaining/)
    expect(() => clear([ord('a', 'buy', 1, 0)])).toThrow(/limit/)
    expect(() => clear([ord('a', 'buy', 1, 100), ord('a', 'sell', 1, 100)])).toThrow(/duplicate/)
  })
})

describe('reproducibility', () => {
  it('same input (in any order) gives the same ClearResult, including the seed', () => {
    const orders = [
      ord('o1', 'buy', 7, 103, 1),
      ord('o2', 'buy', 7, 103, 2),
      ord('o3', 'buy', 3, 101, 2),
      ord('o4', 'sell', 5, 99, 1),
      ord('o5', 'sell', 4, 101, 2),
      ord('o6', 'sell', 4, 101, 2),
      ord('o7', 'sell', 9, 104, 2),
    ]
    const a = clear(orders, 100, 2)
    const b = clear([...orders].reverse(), 100, 2)
    const c = clear([orders[3], orders[0], orders[6], orders[2], orders[5], orders[1], orders[4]], 100, 2)
    expect(b).toEqual(a)
    expect(c).toEqual(a)
    expect(a.volume).toBeGreaterThan(0)
  })

  it('does not mutate its input', () => {
    const orders = [ord('b', 'buy', 10, 105), ord('s', 'sell', 4, 100)]
    const copy = structuredClone(orders)
    clear(orders)
    expect(orders).toEqual(copy)
  })
})

