/**
 * Price line for one ticker this round: stored tape history (`tape`) merged
 * with live prints from the exchange socket. Plain SVG, no chart library.
 */

import { useMemo } from 'react'
import { useQuery } from 'deepspace'
import { LineChart } from 'lucide-react'
import type { Print, TapeRecord, Ticker } from '@/shared/contracts'
import { TICKER_INFO } from '@/components/shell/tickers'
import { NO_ROUND } from '@/components/shell/useCurrentRound'
import { FeedEmpty, FeedError, FeedPanel, FeedSkeleton } from '@/components/feed/FeedPanel'
import { Delta } from '@/theme/Delta'
import { formatPrice } from '@/theme/format'
import { chartPoints, linePath, type ChartPoint } from './logic'

const W = 600
const H = 200

export function PriceChart({
  ticker,
  roundId,
  prints,
  lastCents,
  openCents,
  className,
}: {
  ticker: Ticker
  roundId: string
  prints: Print[]
  lastCents: number | undefined
  openCents: number | undefined
  className?: string
}) {
  const tape = useQuery<TapeRecord>('tape', {
    where: { roundId: roundId || NO_ROUND, ticker },
    orderBy: 'at',
    orderDir: 'desc',
    limit: 300,
  })
  const points = useMemo(
    () => chartPoints(tape.records.map((r) => r.data), prints, ticker, roundId),
    [tape.records, prints, ticker, roundId],
  )
  const status = !roundId ? 'loading' : points.length > 0 ? 'ready' : tape.status
  return (
    <PriceChartView
      ticker={ticker}
      points={points}
      lastCents={lastCents}
      openCents={openCents ?? points[0]?.priceCents}
      status={status}
      error={tape.error}
      className={className}
    />
  )
}

export function PriceChartView({
  ticker,
  points,
  lastCents,
  openCents,
  status,
  error,
  className,
}: {
  ticker: Ticker
  points: ChartPoint[]
  lastCents: number | undefined
  openCents: number | undefined
  status: 'loading' | 'ready' | 'error'
  error?: string
  className?: string
}) {
  const path = useMemo(() => linePath(points, W, H), [points])
  const last = lastCents ?? points[points.length - 1]?.priceCents
  const first = points[0]?.priceCents
  const rising = last !== undefined && first !== undefined ? last >= first : true
  return (
    <FeedPanel
      testId="price-chart"
      title={`${ticker} · ${TICKER_INFO[ticker].name}`}
      meta={points.length > 0 ? `${points.length} batches` : undefined}
      className={className}
    >
      <div className="flex items-baseline gap-3 px-3 pt-3">
        <span className="font-mono text-2xl font-medium tabular-nums" data-testid="chart-last">
          {last ? formatPrice(last) : '—'}
        </span>
        {last && openCents ? (
          <Delta value={(last - openCents) / openCents} kind="percent" className="text-sm" />
        ) : null}
        <span className="ml-auto font-mono text-[11px] uppercase tracking-wider text-muted-foreground">vs round open</span>
      </div>
      {status === 'error' && <FeedError message={error || 'Could not load price history.'} />}
      {status === 'loading' ? (
        <FeedSkeleton rows={5} />
      ) : !path ? (
        status === 'ready' && (
          <FeedEmpty icon={<LineChart />} title="No trades yet this round" description="The line starts with the first print." />
        )
      ) : (
        <div className="relative px-3 pb-3 pt-2">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="h-44 w-full lg:h-52"
            role="img"
            aria-label={`${ticker} price, ${points.length} batches, last ${last ? formatPrice(last) : 'unknown'}`}
          >
            {[0.25, 0.5, 0.75].map((f) => (
              <line key={f} x1={0} x2={W} y1={H * f} y2={H * f} className="stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            <path
              d={path.d}
              fill="none"
              className={rising ? 'stroke-up' : 'stroke-down'}
              strokeWidth={1.5}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <div className="pointer-events-none absolute right-4 top-2 font-mono text-[11px] tabular-nums text-muted-foreground">
            {formatPrice(path.hi)}
          </div>
          <div className="pointer-events-none absolute bottom-4 right-4 font-mono text-[11px] tabular-nums text-muted-foreground">
            {formatPrice(path.lo)}
          </div>
        </div>
      )}
    </FeedPanel>
  )
}
