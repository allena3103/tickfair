import { describe, expect, it } from 'vitest'
import { START_CASH_CENTS, type PortfolioRecord, type TapeRecord } from '@/shared/contracts'
import { equityOf, rankPortfolios } from './rank'
import { buildTape } from './tapeRows'
import { mergeOnline } from './onlineList'
import { roundPhase } from '../shell/RoundStatus'

const last = { ORBT: 4_000, CURA: 2_000, VOLT: 1_000 }

function pf(userId: string, displayName: string, cashCents: number, holdings: Partial<Record<string, number>> = {}): PortfolioRecord {
  return { userId, displayName, roundId: 'r1', cashCents, holdings: { ORBT: 0, CURA: 0, VOLT: 0, ...holdings } }
}

describe('leaderboard ranking', () => {
  it('equity = cash + Σ qty × last', () => {
    expect(equityOf(pf('u1', 'A', 5_000_000, { ORBT: 10, VOLT: 3 }), last)).toBe(5_000_000 + 40_000 + 3_000)
  })

  it('reads holdings stored as a JSON string, and ignores junk', () => {
    const p = { ...pf('u1', 'A', 100), holdings: '{"CURA":2}' as unknown as PortfolioRecord['holdings'] }
    expect(equityOf(p, last)).toBe(100 + 4_000)
    const bad = { ...pf('u1', 'A', 100), holdings: 'not json' as unknown as PortfolioRecord['holdings'] }
    expect(equityOf(bad, last)).toBe(100)
  })

  it('a ticker without a last price counts as zero', () => {
    expect(equityOf(pf('u1', 'A', 100, { ORBT: 5 }), {})).toBe(100)
  })

  it('ranks by equity, excludes bots, and shares ranks on ties', () => {
    const rows = rankPortfolios(
      [
        pf('u1', 'Cleo', START_CASH_CENTS),
        pf('bot:mm', 'Market maker', 99_000_000),
        pf('u2', 'Ana', START_CASH_CENTS),
        pf('u3', 'Bo', START_CASH_CENTS + 500, {}),
        pf('u4', 'Dee', 9_000_000, { ORBT: 100 }),
      ],
      last,
    )
    expect(rows.map((r) => [r.rank, r.displayName])).toEqual([
      [1, 'Bo'],
      [2, 'Ana'],
      [2, 'Cleo'],
      [4, 'Dee'],
    ])
    expect(rows.find((r) => r.userId === 'u3')?.pnlCents).toBe(500)
    expect(rows.find((r) => r.userId === 'u4')?.pnlCents).toBe(9_000_000 + 400_000 - START_CASH_CENTS)
    expect(rows.some((r) => r.userId.startsWith('bot:'))).toBe(false)
  })
})

describe('tape rows', () => {
  const print = (id: string, ticker: TapeRecord['ticker'], batchId: number, clearCents: number, at: number) => ({
    id,
    data: { ticker, roundId: 'r1', batchId, clearCents, volume: 10, seed: 's', at },
  })

  it('sorts newest first and diffs each print against the same ticker', () => {
    const rows = buildTape([
      print('a', 'ORBT', 1, 4_000, 1_000),
      print('b', 'CURA', 1, 2_000, 1_000),
      print('c', 'ORBT', 2, 4_010, 2_000),
      print('d', 'ORBT', 3, 3_990, 3_000),
    ])
    expect(rows.map((r) => r.id)).toEqual(['d', 'c', 'b', 'a'])
    expect(rows.map((r) => r.changeCents)).toEqual([-20, 10, null, null])
  })

  it('filters to one ticker', () => {
    const rows = buildTape([print('a', 'ORBT', 1, 4_000, 1_000), print('b', 'CURA', 1, 2_000, 1_000)], 'CURA')
    expect(rows.map((r) => r.id)).toEqual(['b'])
  })
})

describe('online list', () => {
  it('puts self first, then floor peers, then heartbeat-only users', () => {
    const list = mergeOnline({
      self: { userId: 'me', name: 'Me' },
      peers: [
        { userId: 'zed', userName: 'Zed', state: { ticker: 'VOLT' } },
        { userId: 'me', userName: 'Me', state: { ticker: 'ORBT' } },
        { userId: 'amy', userName: 'Amy', state: { ticker: 'NOPE' } },
      ],
      heartbeat: [
        { id: 'me', name: 'Me' },
        { id: 'zed', name: 'Zed' },
        { id: 'old', name: 'Abe' },
      ],
    })
    expect(list.map((t) => [t.userId, t.onFloor, t.ticker, t.isSelf])).toEqual([
      ['me', true, 'ORBT', true],
      ['amy', true, null, false],
      ['zed', true, 'VOLT', false],
      ['old', false, null, false],
    ])
  })

  it('works signed out', () => {
    expect(mergeOnline({ self: null, peers: [], heartbeat: [{ id: 'a', name: 'A' }] })).toHaveLength(1)
  })
})

describe('round phase', () => {
  const now = 1_000_000
  it('shows time left in a live round', () => {
    expect(roundPhase({ status: 'live', endsAt: now + 60_000 }, now, false)).toEqual({ kind: 'live', msLeft: 60_000 })
  })
  it('counts down the break after a round ends', () => {
    expect(roundPhase({ status: 'done', endsAt: now - 30_000 }, now, false)).toEqual({ kind: 'break', msLeft: 90_000 })
    expect(roundPhase({ status: 'live', endsAt: now - 1 }, now, false).kind).toBe('break')
  })
  it('handles loading and no round', () => {
    expect(roundPhase(null, now, true)).toEqual({ kind: 'loading' })
    expect(roundPhase(null, now, false)).toEqual({ kind: 'none' })
  })
})
