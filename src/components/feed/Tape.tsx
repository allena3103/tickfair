/**
 * Time and sales: one row per batch print from the `tape` collection,
 * newest first. Pass `ticker` for a single-ticker tape.
 */

import { useMemo } from 'react'
import { useQuery } from 'deepspace'
import { Activity } from 'lucide-react'
import type { TapeRecord, Ticker } from '@/shared/contracts'
import { Delta } from '@/theme/Delta'
import { formatPrice, formatQty, formatTimeOfDay } from '@/theme/format'
import { useCurrentRound } from '../shell/useCurrentRound'
import { buildTape, type TapeRow } from './tapeRows'
import { FeedEmpty, FeedError, FeedPanel, FeedSkeleton } from './FeedPanel'

interface TapeProps {
  ticker?: Ticker
  /** Defaults to the current round. */
  roundId?: string
  limit?: number
  className?: string
}

export function Tape({ ticker, roundId, limit = 60, className }: TapeProps) {
  const current = useCurrentRound()
  const round = roundId ?? current.round?.recordId
  const where: Record<string, unknown> = {}
  if (round) where.roundId = round
  if (ticker) where.ticker = ticker
  const { records, status, error } = useQuery<TapeRecord>('tape', { where, orderBy: 'at', orderDir: 'desc', limit })
  const rows = useMemo(
    () => buildTape(records.map((r) => ({ id: r.recordId, data: r.data })), ticker).slice(0, limit),
    [records, ticker, limit],
  )
  const waiting = !roundId && current.status === 'loading'
  return (
    <TapeView
      rows={rows}
      ticker={ticker}
      status={waiting ? 'loading' : status}
      error={error ?? current.error}
      className={className}
    />
  )
}

export function TapeView({
  rows,
  ticker,
  status,
  error,
  className,
}: {
  rows: TapeRow[]
  ticker?: Ticker
  status: 'loading' | 'ready' | 'error'
  error?: string
  className?: string
}) {
  return (
    <FeedPanel testId="tape" title={ticker ? `Tape · ${ticker}` : 'Tape'} className={className}>
      {status === 'error' && <FeedError message={error || 'Could not load the tape.'} />}
      {status === 'loading' ? (
        <FeedSkeleton rows={6} />
      ) : rows.length === 0 ? (
        status === 'ready' && (
          <FeedEmpty
            icon={<Activity />}
            title="No prints yet"
            description="A print appears each second a batch crosses."
          />
        )
      ) : (
        <table className="w-full font-mono text-xs tabular-nums">
          <thead className="sticky top-0 bg-card">
            <tr className="text-muted-foreground">
              <th scope="col" className="px-3 py-1.5 text-left font-normal">
                Time
              </th>
              {!ticker && (
                <th scope="col" className="py-1.5 text-left font-normal">
                  Sym
                </th>
              )}
              <th scope="col" className="py-1.5 text-right font-normal">
                Price
              </th>
              <th scope="col" className="py-1.5 text-right font-normal">
                Chg
              </th>
              <th scope="col" className="px-3 py-1.5 text-right font-normal">
                Shares
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-testid="tape-row" className="border-t border-border">
                <td className="px-3 py-1 text-muted-foreground">{formatTimeOfDay(r.at)}</td>
                {!ticker && <td className="py-1">{r.ticker}</td>}
                <td className="py-1 text-right">{formatPrice(r.clearCents)}</td>
                <td className="py-1 text-right">
                  {r.changeCents === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <Delta value={r.changeCents} />
                  )}
                </td>
                <td className="px-3 py-1 text-right">{formatQty(r.volume)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </FeedPanel>
  )
}
