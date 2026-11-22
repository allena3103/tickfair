/**
 * Loading, empty, error, and populated states for each feed view, rendered
 * to static markup (Node, no DOM). Real data only arrives once the exchange
 * runtime is merged, so these are the checks for states we can't reach in e2e.
 */

import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { START_CASH_CENTS } from '@/shared/contracts'
import { Leaderboard } from './Leaderboard'
import { NewsFeedView } from './NewsFeed'
import { TapeView } from './Tape'
import { OnlineTradersView } from './OnlineTraders'
import { RoundsView } from './RoundsList'

const html = (el: ReactElement) => renderToStaticMarkup(el)
const last = { ORBT: 4_000, CURA: 2_000, VOLT: 1_000 }

describe('Leaderboard', () => {
  it('loading, empty, error', () => {
    expect(html(<Leaderboard portfolios={[]} last={last} status="loading" />)).toContain('data-state="loading"')
    expect(html(<Leaderboard portfolios={[]} last={last} />)).toContain('No traders this round yet')
    const err = html(<Leaderboard portfolios={[]} last={last} status="error" error="boom" />)
    expect(err).toContain('data-state="error"')
    expect(err).toContain('boom')
  })

  it('highlights the current user and pins them when outside the top N', () => {
    const portfolios = ['a', 'b', 'c'].map((id, i) => ({
      userId: id,
      displayName: id.toUpperCase(),
      roundId: 'r',
      cashCents: START_CASH_CENTS - i * 100,
      holdings: { ORBT: 0, CURA: 0, VOLT: 0 },
    }))
    const out = html(<Leaderboard portfolios={portfolios} last={last} currentUserId="c" limit={2} />)
    expect(out.match(/data-testid="leaderboard-row"/g)).toHaveLength(3)
    expect(out).toContain('data-user-id="c" data-self="true"')
    expect(out).toContain('(you)')
    // P&L carries an arrow and a sign, not just a color.
    expect(out).toContain('▼')
    expect(out).toContain('−$1')
  })
})

describe('NewsFeedView', () => {
  const now = 1_000_000_000_000
  it('loading, empty, error', () => {
    expect(html(<NewsFeedView items={[]} now={now} status="loading" />)).toContain('data-state="loading"')
    expect(html(<NewsFeedView items={[]} now={now} status="ready" />)).toContain('No news this round')
    expect(html(<NewsFeedView items={[]} now={now} status="error" />)).toContain('Could not load the news.')
  })
  it('renders headlines with relative time and flags fresh ones', () => {
    const out = html(
      <NewsFeedView
        status="ready"
        now={now}
        items={[
          { id: 'n2', roundId: 'r', ticker: 'CURA', headline: 'Trial passes', body: 'Shares may move.', publishedAt: now - 10_000 },
          { id: 'n1', roundId: 'r', ticker: 'VOLT', headline: 'Grid outage', body: '', publishedAt: now - 300_000 },
        ]}
      />,
    )
    expect(out).toContain('Trial passes')
    expect(out).toContain('10s ago')
    expect(out).toContain('5m ago')
    expect(out.match(/>new</g)).toHaveLength(1)
  })
  it('survives a missing or malformed publishedAt', () => {
    const bad = [undefined, 'soon', Number.NaN, 1e20] as unknown as number[]
    const out = html(
      <NewsFeedView
        status="ready"
        now={now}
        items={[
          ...bad.map((publishedAt, i) => ({ id: `bad${i}`, roundId: 'r', ticker: 'ORBT' as const, headline: `Bad ${i}`, body: '', publishedAt })),
          { id: 'ok', roundId: 'r', ticker: 'CURA', headline: 'Good', body: '', publishedAt: now - 10_000 },
        ]}
      />,
    )
    expect(out).toContain('Bad 0')
    expect(out).toContain('Bad 3')
    expect(out.match(/<time/g)).toHaveLength(1)
    expect(out.match(/>new</g)).toHaveLength(1)
  })
})

describe('TapeView', () => {
  it('loading, empty, error', () => {
    expect(html(<TapeView rows={[]} status="loading" />)).toContain('data-state="loading"')
    expect(html(<TapeView rows={[]} status="ready" />)).toContain('No prints yet')
    expect(html(<TapeView rows={[]} status="error" error="down" />)).toContain('down')
  })
  it('renders signed changes', () => {
    const out = html(
      <TapeView
        status="ready"
        rows={[
          { id: 'b', ticker: 'ORBT', roundId: 'r', batchId: 2, clearCents: 4_010, volume: 1_200, seed: 's', at: 0, changeCents: 10 },
          { id: 'a', ticker: 'ORBT', roundId: 'r', batchId: 1, clearCents: 4_000, volume: 5, seed: 's', at: 0, changeCents: null },
        ]}
      />,
    )
    expect(out).toContain('40.10')
    expect(out).toContain('+0.10')
    expect(out).toContain('1,200')
  })
})

describe('OnlineTradersView', () => {
  it('loading, empty, reconnecting', () => {
    expect(html(<OnlineTradersView traders={[]} status="connecting" />)).toContain('data-state="loading"')
    expect(html(<OnlineTradersView traders={[]} status="signed-out" />)).toContain('Sign in to show up on the floor.')
    expect(html(<OnlineTradersView traders={[]} status="reconnecting" />)).toContain('Reconnecting')
  })
  it('lists traders with their ticker', () => {
    const out = html(
      <OnlineTradersView
        status="connected"
        traders={[
          { userId: 'me', name: 'Me', ticker: 'ORBT', onFloor: true, isSelf: true },
          { userId: 'x', name: 'Xi', ticker: null, onFloor: false, isSelf: false },
        ]}
      />,
    )
    expect(out).toContain('2 online')
    expect(out).toContain('ORBT')
    expect(out).toContain('idle')
  })
})

describe('RoundsView', () => {
  it('loading, empty, error', () => {
    expect(html(<RoundsView rounds={[]} status="loading" />)).toContain('data-state="loading"')
    expect(html(<RoundsView rounds={[]} status="ready" />)).toContain('No finished rounds yet')
    expect(html(<RoundsView rounds={[]} status="error" />)).toContain('Could not load past rounds.')
  })
  it('shows the winner and duration, without bots', () => {
    const out = html(
      <RoundsView
        status="ready"
        rounds={[
          {
            id: 'r1',
            startsAt: 0,
            endsAt: 15 * 60_000,
            status: 'done',
            winnerId: 'u1',
            standings: [
              { userId: 'bot:mm', displayName: 'MM', equityCents: 99_000_000 },
              { userId: 'u1', displayName: 'Ana', equityCents: 10_250_000 },
              { userId: 'u2', displayName: 'Bo', equityCents: 9_900_000 },
            ],
          },
        ]}
      />,
    )
    expect(out).toContain('Ana')
    expect(out).toContain('15:00')
    expect(out).toContain('2 traders')
    expect(out).not.toContain('MM')
  })

  it('falls back to the top human when winnerId is missing, stale, or a bot', () => {
    for (const winnerId of ['', 'gone', 'bot:mm']) {
      const out = html(
        <RoundsView
          status="ready"
          rounds={[
            {
              id: 'r1',
              startsAt: 0,
              endsAt: 15 * 60_000,
              status: 'done',
              winnerId,
              standings: [
                { userId: 'bot:mm', displayName: 'MM', equityCents: 99_000_000 },
                { userId: 'u2', displayName: 'Bo', equityCents: 9_900_000 },
                { userId: 'u1', displayName: 'Ana', equityCents: 10_250_000 },
              ],
            },
          ]}
        />,
      )
      expect(out).toMatch(/font-medium">Ana</)
      expect(out).not.toContain('No human traders')
    }
  })

  it('says no human traders only when there are none', () => {
    const out = html(
      <RoundsView
        status="ready"
        rounds={[
          {
            id: 'r',
            startsAt: 0,
            endsAt: 1,
            status: 'done',
            winnerId: 'bot:mm',
            standings: [{ userId: 'bot:mm', displayName: 'MM', equityCents: 1 }],
          },
        ]}
      />,
    )
    expect(out).toContain('No human traders')
    expect(out).toContain('0 traders')
  })
})
