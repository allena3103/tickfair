/**
 * Round leaderboard. Pure: the caller passes the round's portfolios and the
 * latest prices (ui-trading feeds live `last` from the exchange stream), so
 * equity updates every batch with no extra record writes.
 */

import { useMemo } from 'react'
import { Trophy } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PortfolioRecord, Ticker } from '@/shared/contracts'
import { Delta } from '@/theme/Delta'
import { formatCents } from '@/theme/format'
import { rankPortfolios, type LeaderRow } from './rank'
import { FeedEmpty, FeedError, FeedPanel, FeedSkeleton } from './FeedPanel'

interface LeaderboardProps {
  /** Portfolio record data (`record.data`) for the current round. */
  portfolios: PortfolioRecord[]
  /** Last clearing price per ticker, in cents. */
  last: Partial<Record<Ticker, number>>
  /** Highlighted, and pinned below the list when ranked outside `limit`. */
  currentUserId?: string | null
  status?: 'loading' | 'ready' | 'error'
  error?: string
  limit?: number
  className?: string
}

export function Leaderboard({
  portfolios,
  last,
  currentUserId,
  status = 'ready',
  error,
  limit = 10,
  className,
}: LeaderboardProps) {
  const rows = useMemo(() => rankPortfolios(portfolios, last), [portfolios, last])
  const top = rows.slice(0, limit)
  const mine = currentUserId ? rows.find((r) => r.userId === currentUserId) : undefined
  const pinned = mine && !top.includes(mine) ? mine : undefined

  return (
    <FeedPanel
      testId="leaderboard"
      title="Leaderboard"
      meta={status === 'ready' && rows.length > 0 ? `${rows.length} traders` : undefined}
      className={className}
    >
      {status === 'error' && <FeedError message={error || 'Could not load the leaderboard.'} />}
      {status === 'loading' ? (
        <FeedSkeleton rows={5} />
      ) : rows.length === 0 ? (
        status === 'ready' && (
          <FeedEmpty
            icon={<Trophy />}
            title="No traders this round yet"
            description="Place an order and you're on the board."
          />
        )
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="font-mono text-xs text-muted-foreground">
              <th scope="col" className="w-10 px-3 py-1.5 text-left font-normal">
                #
              </th>
              <th scope="col" className="py-1.5 text-left font-normal">
                Trader
              </th>
              <th scope="col" className="py-1.5 text-right font-normal">
                Equity
              </th>
              <th scope="col" className="px-3 py-1.5 text-right font-normal">
                P&amp;L
              </th>
            </tr>
          </thead>
          <tbody>
            {top.map((r) => (
              <Row key={r.userId} row={r} isSelf={r.userId === currentUserId} />
            ))}
            {pinned && (
              <>
                <tr aria-hidden>
                  <td colSpan={4} className="px-3 py-0.5 text-center font-mono text-xs text-muted-foreground">
                    ⋯
                  </td>
                </tr>
                <Row row={pinned} isSelf />
              </>
            )}
          </tbody>
        </table>
      )}
    </FeedPanel>
  )
}

function Row({ row, isSelf }: { row: LeaderRow; isSelf: boolean }) {
  return (
    <tr
      data-testid="leaderboard-row"
      data-user-id={row.userId}
      data-self={isSelf}
      aria-current={isSelf ? 'true' : undefined}
      className={cn('border-t border-border', isSelf && 'bg-accent')}
    >
      <td className="px-3 py-1.5 font-mono tabular-nums text-muted-foreground">{row.rank}</td>
      <td className="max-w-0 truncate py-1.5">
        {isSelf && <span className="mr-1.5 inline-block h-3 w-0.5 bg-primary align-middle" aria-hidden />}
        {row.displayName}
        {isSelf && <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>}
      </td>
      <td className="py-1.5 text-right font-mono tabular-nums">{formatCents(row.equityCents, { whole: true })}</td>
      <td className="px-3 py-1.5 text-right">
        <Delta value={row.pnlCents} kind="money" whole />
      </td>
    </tr>
  )
}
