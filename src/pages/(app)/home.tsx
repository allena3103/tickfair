/* home pattern: data-forward — the live floor: prices, leaderboard, news, tape, and who's online above the fold */

/**
 * /home: the floor overview, readable signed in or out. Prices come from the
 * `tickers` collection (updated by the engine's mirror), so this page needs
 * no exchange socket. The full terminal lives at /trade (ui-trading).
 */

import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuthStatus, useQuery } from 'deepspace'
import { ArrowRight } from 'lucide-react'
import { TICKERS, type PortfolioRecord, type Ticker, type TickerRecord } from '@/shared/contracts'
import { Leaderboard } from '@/components/feed/Leaderboard'
import { NewsFeed } from '@/components/feed/NewsFeed'
import { OnlineTraders } from '@/components/feed/OnlineTraders'
import { portfoliosQuery } from '@/components/feed/queries'
import { Tape } from '@/components/feed/Tape'
import { TICKER_INFO } from '@/components/shell/tickers'
import { feedStatus, resolveFeedRound, useCurrentRound } from '@/components/shell/useCurrentRound'
import { Delta } from '@/theme/Delta'
import { formatPrice } from '@/theme/format'

export default function HomePage() {
  const { isSignedIn, userId } = useAuthStatus()
  const round = resolveFeedRound(undefined, useCurrentRound())

  const tickers = useQuery<TickerRecord>('tickers')
  const bySymbol = useMemo(() => {
    const map = new Map<Ticker, TickerRecord>()
    for (const r of tickers.records) map.set(r.recordId as Ticker, r.data)
    return map
  }, [tickers.records])
  const last = useMemo(() => {
    const out: Partial<Record<Ticker, number>> = {}
    for (const t of TICKERS) {
      const px = bySymbol.get(t)?.lastCents
      if (typeof px === 'number') out[t] = px
    }
    return out
  }, [bySymbol])

  // No round yet → NO_ROUND matches nothing, not every round's portfolios.
  // No limit: it would re-subscribe on every fill (see queries.ts).
  const portfolioOptions = useMemo(() => portfoliosQuery(round.roundId), [round.roundId])
  const portfolios = useQuery<PortfolioRecord>('portfolios', portfolioOptions)
  const portfolioData = useMemo(() => portfolios.records.map((r) => r.data), [portfolios.records])
  const board = feedStatus(round, portfolios)

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">The floor</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Three stocks, one price per second. Watch who&apos;s winning this round.
          </p>
        </div>
        <Link
          to="/trade"
          data-testid="open-terminal"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          {isSignedIn ? 'Open the terminal' : 'Sign in to trade'}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>

      <ul data-testid="ticker-strip" className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
        {TICKERS.map((t) => {
          const rec = bySymbol.get(t)
          const loading = tickers.status === 'loading'
          const change = rec && rec.openCents > 0 ? rec.lastCents - rec.openCents : null
          return (
            <li key={t} className="flex items-baseline justify-between gap-3 bg-card px-4 py-3">
              <div className="min-w-0">
                <p className="font-mono text-base font-semibold">{t}</p>
                <p className="truncate text-xs text-muted-foreground">{rec?.name || TICKER_INFO[t].name}</p>
              </div>
              {loading ? (
                <div className="h-5 w-20 animate-pulse rounded-md bg-muted" aria-hidden />
              ) : (
                <div className="text-right">
                  <p className="font-mono text-lg tabular-nums">{rec ? formatPrice(rec.lastCents) : '—'}</p>
                  {change !== null && rec ? (
                    <Delta value={change / rec.openCents} kind="percent" className="text-xs" />
                  ) : (
                    <p className="font-mono text-xs text-muted-foreground">{rec ? '' : 'no trades yet'}</p>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <Leaderboard
          portfolios={portfolioData}
          last={last}
          currentUserId={userId}
          status={board.status}
          error={board.error}
          className="max-h-[420px]"
        />
        <NewsFeed className="max-h-[420px]" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <Tape className="max-h-[360px]" />
        <OnlineTraders className="max-h-[360px]" />
      </div>
    </div>
  )
}
