/**
 * Loading, empty, error, and populated states of the terminal panels,
 * rendered to static markup. e2e covers the populated path on the real engine;
 * these cover the states the live engine rarely shows.
 */
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { START_CASH_CENTS } from '@/shared/contracts'
import { DepthLadder } from './DepthLadder'
import { MyFills, OpenOrders, Positions } from './MyOrders'
import { PriceChartView } from './PriceChart'
import { RoundBreakOverlay } from './RoundBreak'
import { BatchClock } from './BatchClock'
import { finishedRound, portfolioView } from './logic'

const html = (el: ReactElement) => renderToStaticMarkup(el)
const noop = () => {}

describe('DepthLadder', () => {
  it('loading, closed, empty, error', () => {
    expect(html(<DepthLadder ticker="ORBT" depth={undefined} lastCents={1_000} status="loading" />)).toContain('data-state="loading"')
    expect(html(<DepthLadder ticker="ORBT" depth={undefined} lastCents={1_000} status="closed" />)).toContain('Book closed')
    expect(html(<DepthLadder ticker="ORBT" depth={{ bids: [], asks: [] }} lastCents={1_000} status="ready" />)).toContain('No resting orders')
    expect(html(<DepthLadder ticker="ORBT" depth={undefined} lastCents={1_000} status="error" />)).toContain('data-state="error"')
  })
  it('shows levels, the spread, and a crossed book in words', () => {
    const out = html(<DepthLadder ticker="ORBT" depth={{ bids: [[990, 5]], asks: [[1_010, 8]] }} lastCents={1_000} status="ready" />)
    expect(out).toContain('spread 0.20')
    expect(out.match(/data-testid="ladder-(bid|ask)"/g)).toHaveLength(2)
    const crossed = html(<DepthLadder ticker="ORBT" depth={{ bids: [[1_020, 5]], asks: [[1_010, 8]] }} lastCents={1_000} status="ready" />)
    expect(crossed).toContain('crosses next batch')
  })
})

describe('my panels', () => {
  it('open orders: loading, empty, error, populated', () => {
    expect(html(<OpenOrders orders={[]} status="loading" canCancel />)).toContain('data-state="loading"')
    expect(html(<OpenOrders orders={[]} status="ready" canCancel />)).toContain('No open orders')
    expect(html(<OpenOrders orders={[]} status="error" canCancel />)).toContain('Could not load your orders.')
    const out = html(
      <OpenOrders
        status="ready"
        canCancel={false}
        orders={[{ id: 'o-1', userId: 'u', ticker: 'VOLT', side: 'sell', type: 'limit', qty: 10, limitCents: 4_210, filledQty: 4, avgFillCents: 0, status: 'partial', batchId: 1, roundId: 'r' }]}
      />,
    )
    expect(out).toContain('data-order-id="o-1"')
    expect(out).toContain('42.10')
    expect(out).toMatch(/<button[^>]*disabled/)
  })
  it('fills: loading, empty, error', () => {
    expect(html(<MyFills fills={[]} status="loading" />)).toContain('data-state="loading"')
    expect(html(<MyFills fills={[]} status="ready" />)).toContain('No fills yet')
    expect(html(<MyFills fills={[]} status="error" />)).toContain('Could not load your fills.')
  })
  it('positions: loading, error, starting cash, holdings', () => {
    const fresh = portfolioView(null, {}, [])
    expect(html(<Positions view={fresh} status="loading" active="ORBT" />)).toContain('data-state="loading"')
    expect(html(<Positions view={fresh} status="error" active="ORBT" />)).toContain('Could not load your portfolio.')
    expect(html(<Positions view={fresh} status="ready" active="ORBT" />)).toContain('No shares held')
    const held = portfolioView({ cashCents: START_CASH_CENTS - 10_000, holdings: { ORBT: 10, CURA: 0, VOLT: 0 } }, { ORBT: 1_100 }, [])
    const out = html(<Positions view={held} status="ready" active="ORBT" />)
    expect(out).toContain('data-ticker="ORBT"')
    expect(out).toContain('▲')
  })
})

describe('PriceChartView', () => {
  it('loading, empty, error, line', () => {
    const base = { ticker: 'CURA' as const, lastCents: undefined, openCents: undefined }
    expect(html(<PriceChartView {...base} points={[]} status="loading" />)).toContain('data-state="loading"')
    expect(html(<PriceChartView {...base} points={[]} status="ready" />)).toContain('No trades yet this round')
    expect(html(<PriceChartView {...base} points={[]} status="error" />)).toContain('Could not load price history.')
    const out = html(
      <PriceChartView {...base} lastCents={1_020} openCents={1_000} status="ready" points={[{ batchId: 1, priceCents: 1_000 }, { batchId: 2, priceCents: 1_020 }]} />,
    )
    expect(out).toContain('<path')
    expect(out).toContain('+2.00%')
  })
})

describe('BatchClock and round break', () => {
  it('names each connection state', () => {
    const props = { phaseEndsAt: 0, batchId: 7, nextBatchAt: 0 }
    expect(html(<BatchClock {...props} connected={false} synced={false} phase={null} />)).toContain('data-phase="connecting"')
    expect(html(<BatchClock {...props} connected={false} synced phase="live" />)).toContain('Reconnecting')
    expect(html(<BatchClock {...props} connected synced phase="live" />)).toContain('#7')
    expect(html(<BatchClock {...props} connected synced phase="break" />)).toContain('Results break')
  })
  it('break overlay: tallying, no humans, standings without bots', () => {
    expect(html(<RoundBreakOverlay round={null} phaseEndsAt={0} currentUserId={null} onHide={noop} />)).toContain('Tallying')
    const round = { startsAt: 0, endsAt: 1, status: 'done' as const, winnerId: 'u1', standings: [] }
    expect(html(<RoundBreakOverlay round={round} phaseEndsAt={0} currentUserId={null} onHide={noop} />)).toContain('No human traders')
    const out = html(
      <RoundBreakOverlay
        round={{ ...round, standings: [{ userId: 'bot:mm', displayName: 'MM', equityCents: 1 }, { userId: 'u1', displayName: 'Ana', equityCents: 10_100_000 }] }}
        phaseEndsAt={0}
        currentUserId="u1"
        onHide={noop}
      />,
    )
    expect(out).toContain('Ana')
    expect(out).toContain('(you)')
    expect(out).not.toContain('MM')
  })

  it('page path: the done record for the closed round id renders one standing row per human', () => {
    // During the break, ex.phase and ex.snapshot carry the round that just closed (core.ts closeRound).
    const round = { startsAt: 0, endsAt: 1, status: 'done' as const, winnerId: 'u1' }
    const records = [
      {
        recordId: 'r-closed',
        data: {
          ...round,
          standings: [
            { userId: 'u2', displayName: 'Bo', equityCents: 9_900_000 },
            { userId: 'bot:noise', displayName: 'Noise', equityCents: 5 },
            { userId: 'u1', displayName: 'Ana', equityCents: 10_250_000 },
          ],
        },
      },
      { recordId: 'r-older', data: { ...round, standings: [{ userId: 'u9', displayName: 'Old', equityCents: 1 }] } },
    ]
    const out = html(<RoundBreakOverlay round={finishedRound(records, 'r-closed')} phaseEndsAt={0} currentUserId="u2" onHide={noop} />)
    expect(out.match(/data-testid="final-standing"/g)).toHaveLength(2)
    const names = [...out.matchAll(/data-testid="final-standing".*?<span class="min-w-0 flex-1 truncate">([^<]+)/g)].map((m) => m[1])
    expect(names).toEqual(['Ana', 'Bo'])
    expect(out).toContain('▲')
    expect(out).not.toContain('Old')
    expect(out).not.toContain('Tallying')
  })
})
