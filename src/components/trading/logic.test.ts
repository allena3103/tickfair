import { describe, expect, it } from 'vitest'
import { START_CASH_CENTS, type OrderRecord, type RejectCode } from '@/shared/contracts'
import {
  INITIAL_STREAM,
  backoffMs,
  isServerMsg,
  streamReducer,
  type ExchangeState,
} from '@/hooks/useExchangeStream'
import {
  REJECT_MESSAGES,
  cancelFailureToShow,
  chartPoints,
  finishedRound,
  liveOrderRows,
  ladderRows,
  linePath,
  parsePriceInput,
  plural,
  parseQtyInput,
  portfolioView,
  readHoldings,
  rejectIsStale,
  rejectMessage,
  reservedBy,
  ticketReserve,
} from './logic'

const order = (o: Partial<OrderRecord>): OrderRecord => ({
  userId: 'u',
  ticker: 'ORBT',
  side: 'buy',
  type: 'limit',
  qty: 10,
  limitCents: 1_000,
  filledQty: 0,
  avgFillCents: 0,
  status: 'open',
  batchId: 1,
  roundId: 'r',
  ...o,
})

describe('ticketReserve', () => {
  it('limit buy reserves qty × limit', () => {
    expect(ticketReserve({ side: 'buy', type: 'limit', qty: 10, limitCents: 4_210, lastCents: 4_000 })).toEqual({
      kind: 'cash',
      cents: 42_100,
      priceCents: 4_210,
    })
  })
  it('market buy reserves at the band top, rounded inward like the engine', () => {
    // last 1005 → hi floor(1005 × 1.1) = 1105
    expect(ticketReserve({ side: 'buy', type: 'market', qty: 2, limitCents: null, lastCents: 1_005 })).toEqual({
      kind: 'cash',
      cents: 2_210,
      priceCents: 1_105,
    })
  })
  it('sells reserve shares', () => {
    expect(ticketReserve({ side: 'sell', type: 'market', qty: 7, limitCents: null, lastCents: 1_000 })).toEqual({ kind: 'shares', qty: 7 })
  })
  it('returns null for incomplete input', () => {
    expect(ticketReserve({ side: 'buy', type: 'limit', qty: 0, limitCents: 100, lastCents: 100 })).toBeNull()
    expect(ticketReserve({ side: 'buy', type: 'limit', qty: 1, limitCents: null, lastCents: 100 })).toBeNull()
    expect(ticketReserve({ side: 'buy', type: 'market', qty: 1, limitCents: null, lastCents: null })).toBeNull()
  })
})

describe('input parsing', () => {
  it('prices', () => {
    expect(parsePriceInput('42.10')).toBe(4_210)
    expect(parsePriceInput('42.1')).toBe(4_210)
    expect(parsePriceInput(' 42 ')).toBe(4_200)
    expect(parsePriceInput('0.05')).toBe(5)
    for (const bad of ['', '0', '-1', '1.234', 'abc', '1e3', '1,000']) expect(parsePriceInput(bad)).toBeNull()
  })
  it('quantities', () => {
    expect(parseQtyInput('10')).toBe(10)
    for (const bad of ['', '0', '1.5', '-3', 'x']) expect(parseQtyInput(bad)).toBeNull()
  })
})

describe('reject messages', () => {
  it('covers every reject code with a short sentence', () => {
    const codes: RejectCode[] = [
      'round_closed', 'invalid_ticker', 'invalid_side', 'invalid_type', 'invalid_qty', 'invalid_price', 'outside_band',
      'insufficient_cash', 'insufficient_shares', 'self_cross', 'rate_limited', 'too_many_open', 'not_found', 'not_owner',
      'already_final', 'forbidden',
    ]
    for (const c of codes) {
      const msg = REJECT_MESSAGES[c]
      expect(msg).toMatch(/\.$/)
      expect(msg).not.toContain('!')
      expect(msg).not.toContain(c)
    }
    expect(rejectMessage('weird')).toMatch(/Try again/)
  })
})

describe('portfolio math', () => {
  it('reserved = remaining buys × limit, remaining sells by ticker; final orders ignored', () => {
    const r = reservedBy([
      order({ qty: 10, filledQty: 4, limitCents: 1_000 }),
      order({ side: 'sell', ticker: 'CURA', qty: 5, filledQty: 1 }),
      order({ status: 'filled', qty: 99 }),
      order({ status: 'cancelled', qty: 99 }),
    ])
    expect(r.cashCents).toBe(6_000)
    expect(r.shares).toEqual({ ORBT: 0, CURA: 4, VOLT: 0 })
  })

  it('no portfolio yet = starting cash, zero P&L', () => {
    const v = portfolioView(null, { ORBT: 1_000 }, [])
    expect(v.cashCents).toBe(START_CASH_CENTS)
    expect(v.equityCents).toBe(START_CASH_CENTS)
    expect(v.pnlCents).toBe(0)
  })

  it('marks holdings to last and subtracts reserved cash from free cash (LESSONS 23)', () => {
    const v = portfolioView(
      { cashCents: 9_000_000, holdings: JSON.stringify({ ORBT: 100, CURA: 0, VOLT: 0 }) as never },
      { ORBT: 11_000 },
      [order({ qty: 10, limitCents: 5_000 })],
    )
    expect(v.equityCents).toBe(9_000_000 + 1_100_000)
    expect(v.pnlCents).toBe(100_000)
    expect(v.freeCashCents).toBe(9_000_000 - 50_000)
  })

  it('readHoldings tolerates junk', () => {
    expect(readHoldings('not json')).toEqual({ ORBT: 0, CURA: 0, VOLT: 0 })
    expect(readHoldings({ ORBT: '3', VOLT: null })).toEqual({ ORBT: 3, CURA: 0, VOLT: 0 })
  })
})

describe('chart', () => {
  it('merges tape and prints per batch for one ticker and round, oldest first', () => {
    const pts = chartPoints(
      [
        { ticker: 'ORBT', roundId: 'r', batchId: 2, clearCents: 1_010 },
        { ticker: 'ORBT', roundId: 'old', batchId: 1, clearCents: 9 },
        { ticker: 'CURA', roundId: 'r', batchId: 1, clearCents: 9 },
      ],
      [
        { ticker: 'ORBT', roundId: 'r', batchId: 3, clearCents: 1_020 },
        { ticker: 'ORBT', roundId: 'r', batchId: 2, clearCents: 1_010 },
        { ticker: 'ORBT', roundId: 'r', batchId: 1, clearCents: 1_000 },
      ],
      'ORBT',
      'r',
    )
    expect(pts).toEqual([
      { batchId: 1, priceCents: 1_000 },
      { batchId: 2, priceCents: 1_010 },
      { batchId: 3, priceCents: 1_020 },
    ])
  })
  it('line path handles empty, single, and flat series', () => {
    expect(linePath([], 100, 50)).toBeNull()
    expect(linePath([{ batchId: 1, priceCents: 500 }], 100, 50)?.d).toMatch(/^M100\.0,/)
    const flat = linePath([{ batchId: 1, priceCents: 500 }, { batchId: 2, priceCents: 500 }], 100, 50)
    expect(flat?.d).toBe('M0.0,25.0 L100.0,25.0')
  })
})

describe('ladder', () => {
  it('orders asks high→low above bids high→low and reports the spread', () => {
    const l = ladderRows({ bids: [[990, 5], [1_000, 2]], asks: [[1_020, 1], [1_010, 8]] })
    expect(l.asks.map((a) => a[0])).toEqual([1_020, 1_010])
    expect(l.bids.map((b) => b[0])).toEqual([1_000, 990])
    expect(l.spreadCents).toBe(10)
    expect(l.maxQty).toBe(8)
    expect(ladderRows(undefined).spreadCents).toBeNull()
  })
})

describe('streamReducer', () => {
  const depth = { ORBT: { bids: [[1, 1]], asks: [] }, CURA: { bids: [], asks: [] }, VOLT: { bids: [], asks: [] } } as never
  const snap = (over: Partial<Record<string, unknown>> = {}) =>
    ({
      type: 'ex.snapshot',
      roundId: 'r1',
      phase: 'live',
      phaseEndsAt: 100,
      batchId: 5,
      nextBatchAt: 50,
      last: { ORBT: 1_000, CURA: 2_000, VOLT: 3_000 },
      depth,
      recentPrints: [
        { ticker: 'ORBT', roundId: 'r1', batchId: 4, clearCents: 1_000, volume: 1, seed: 's' },
        { ticker: 'ORBT', roundId: 'r1', batchId: 3, clearCents: 990, volume: 1, seed: 's' },
      ],
      ...over,
    }) as never

  it('ignores deltas before the first snapshot', () => {
    const s = streamReducer(INITIAL_STREAM, { type: 'msg', msg: { type: 'ex.phase', roundId: 'r', phase: 'live', phaseEndsAt: 1 } })
    expect(s).toBe(INITIAL_STREAM)
  })

  it('snapshot is truth: replaces state, sorts prints, marks connected', () => {
    const dirty: ExchangeState = { ...INITIAL_STREAM, synced: true, roundId: 'old', prints: [{ ticker: 'VOLT', roundId: 'old', batchId: 9, clearCents: 1, volume: 1, seed: 'x' }] }
    const s = streamReducer(dirty, { type: 'msg', msg: snap() })
    expect(s.connected).toBe(true)
    expect(s.roundId).toBe('r1')
    expect(s.prints.map((p) => p.batchId)).toEqual([3, 4])
  })

  it('batch appends new prints once and updates last', () => {
    let s = streamReducer(INITIAL_STREAM, { type: 'msg', msg: snap() })
    const p5 = { ticker: 'ORBT' as const, roundId: 'r1', batchId: 5, clearCents: 1_010, volume: 2, seed: 's' }
    const batch = { type: 'ex.batch' as const, roundId: 'r1', batchId: 6, nextBatchAt: 60, last: { ORBT: 1_010, CURA: 2_000, VOLT: 3_000 }, depth, prints: [p5] }
    s = streamReducer(s, { type: 'msg', msg: batch })
    s = streamReducer(s, { type: 'msg', msg: batch })
    expect(s.prints.filter((p) => p.batchId === 5)).toHaveLength(1)
    expect(s.last.ORBT).toBe(1_010)
    expect(s.batchId).toBe(6)
  })

  it('phase change to break clears the book; close keeps data but drops connected', () => {
    let s = streamReducer(INITIAL_STREAM, { type: 'msg', msg: snap() })
    s = streamReducer(s, { type: 'msg', msg: { type: 'ex.phase', roundId: 'r1', phase: 'break', phaseEndsAt: 200 } })
    expect(s.phase).toBe('break')
    expect(s.depth).toEqual({})
    s = streamReducer(s, { type: 'close' })
    expect(s.connected).toBe(false)
    expect(s.synced).toBe(true)
    expect(s.last.ORBT).toBe(1_000)
  })

  it('validates message types and backs off with a cap', () => {
    expect(isServerMsg({ type: 'ex.batch' })).toBe(true)
    expect(isServerMsg({ type: 'other' })).toBe(false)
    expect(isServerMsg(null)).toBe(false)
    expect(backoffMs(0, 0.5)).toBe(500)
    expect(backoffMs(1, 0.5)).toBe(1_000)
    expect(backoffMs(20, 0.5)).toBe(10_000)
    expect(backoffMs(20, 1)).toBeLessThanOrEqual(12_500)
  })
})

describe('liveOrderRows (F1)', () => {
  const rec = (id: string, o: Partial<OrderRecord>) => ({ recordId: id, data: order(o) })
  it('keeps every live order however many finished ones the round has', () => {
    // The page only queries status open and partial, so 300 filled orders never enter these sets.
    const open = Array.from({ length: 20 }, (_, i) => rec(`o-${i}`, { batchId: i, status: 'open' }))
    const partial = [rec('p-1', { batchId: 99, status: 'partial', filledQty: 3 })]
    const rows = liveOrderRows([open, partial], 'u')
    expect(rows).toHaveLength(21)
    expect(rows[0].id).toBe('p-1')
    expect(reservedBy(rows).cashCents).toBe(20 * 10 * 1_000 + 7 * 1_000)
  })
  it('dedupes an order caught in both sets (partial wins), drops others and finished rows', () => {
    const rows = liveOrderRows(
      [
        [rec('x', { status: 'open' }), rec('y', { userId: 'someone-else' }), rec('z', { status: 'filled' })],
        [rec('x', { status: 'partial', filledQty: 4 })],
      ],
      'u',
    )
    expect(rows.map((r) => [r.id, r.status])).toEqual([['x', 'partial']])
  })
})

describe('finishedRound (Q1)', () => {
  const done = { startsAt: 0, endsAt: 1, status: 'done', standings: [{ userId: 'u', displayName: 'A', equityCents: 1 }], winnerId: 'u' }
  it('returns the closed round by id once it is done', () => {
    const records = [{ recordId: 'r-2', data: done }, { recordId: 'r-1', data: { ...done, winnerId: 'old' } }]
    expect(finishedRound(records, 'r-2')).toBe(done)
  })
  it('is null (tallying) while the record is still live, missing, or another round', () => {
    expect(finishedRound([{ recordId: 'r-2', data: { ...done, status: 'live' } }], 'r-2')).toBeNull()
    expect(finishedRound([], 'r-2')).toBeNull()
    expect(finishedRound([{ recordId: 'r-1', data: done }], 'r-2')).toBeNull()
  })
})

describe('plural (BUG-5a)', () => {
  it('says 1 batch, 0 or many batches', () => {
    expect(plural(1, 'batch', 'batches')).toBe('1 batch')
    expect(plural(0, 'batch', 'batches')).toBe('0 batches')
    expect(plural(1200, 'batch', 'batches')).toBe('1,200 batches')
  })
})

describe('cancelFailureToShow (E2-1)', () => {
  const failure = { orderId: 'o-1', message: REJECT_MESSAGES.already_final }
  it('shows the error while the order is still listed', () => {
    expect(cancelFailureToShow(failure, [{ id: 'o-2' }, { id: 'o-1' }])).toBe(REJECT_MESSAGES.already_final)
  })
  it('clears once the order leaves the list (filled in the same batch as the cancel)', () => {
    expect(cancelFailureToShow(failure, [{ id: 'o-2' }])).toBeNull()
    expect(cancelFailureToShow(failure, [])).toBeNull()
  })
  it('shows nothing without a failure', () => {
    expect(cancelFailureToShow(null, [{ id: 'o-1' }])).toBeNull()
  })
})

describe('rejectIsStale (BUG-1)', () => {
  const shownAt = { freeCashCents: 50_000, freeShares: 0 }
  it('keeps the reject while free cash and shares are unchanged', () => {
    expect(rejectIsStale(shownAt, 50_000, 0)).toBe(false)
  })
  it('drops it once free shares or free cash change (a cancel or a fill)', () => {
    expect(rejectIsStale(shownAt, 50_000, 5)).toBe(true)
    expect(rejectIsStale(shownAt, 60_000, 0)).toBe(true)
  })
})
