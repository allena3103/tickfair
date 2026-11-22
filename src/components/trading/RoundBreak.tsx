/**
 * Round-break overlay: final standings of the round that just ended and the
 * time until the next one. It covers the terminal while trading is closed;
 * "View the board" hides it so you can still read the book and your fills.
 */

import { Trophy } from 'lucide-react'
import { START_CASH_CENTS, type RoundRecord } from '@/shared/contracts'
import { humanStandings } from '@/components/feed/RoundsList'
import { cn } from '@/lib/utils'
import { Delta } from '@/theme/Delta'
import { formatCents, formatClock } from '@/theme/format'
import { useNow } from '@/components/shell/useNow'

export function RoundBreakOverlay({
  round,
  phaseEndsAt,
  currentUserId,
  onHide,
}: {
  /** The finished round's record, once its standings are written. */
  round: RoundRecord | null
  phaseEndsAt: number
  currentUserId: string | null
  onHide: () => void
}) {
  const now = useNow(1000)
  const standings = round && round.status === 'done' ? humanStandings(round.standings) : null
  return (
    <div className="absolute inset-0 z-20 flex items-start justify-center bg-background/85 px-4 pt-16" data-testid="round-break">
      <div role="dialog" aria-modal="false" aria-labelledby="round-break-title" className="w-full max-w-md rounded-lg border border-border bg-card">
        <header className="flex items-baseline justify-between border-b border-border px-4 py-3">
          <h2 id="round-break-title" className="text-base font-semibold">
            Round over
          </h2>
          <span className="font-mono text-xs text-muted-foreground">
            Next round in{' '}
            <span className="tabular-nums text-foreground" data-testid="break-countdown">
              {formatClock(phaseEndsAt - now)}
            </span>
          </span>
        </header>
        <div className="max-h-[50vh] overflow-y-auto">
          {standings === null ? (
            <p className="px-4 py-6 text-sm text-muted-foreground" data-state="loading">
              Tallying final standings.
            </p>
          ) : standings.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground" data-state="empty">
              No human traders this round.
            </p>
          ) : (
            <ol className="divide-y divide-border">
              {standings.slice(0, 10).map((s, i) => {
                const self = s.userId === currentUserId
                return (
                  <li
                    key={s.userId}
                    data-testid="final-standing"
                    className={cn('flex items-center gap-3 px-4 py-2 text-sm', self && 'bg-accent')}
                  >
                    <span className="w-5 font-mono text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                    {i === 0 && <Trophy className="h-3.5 w-3.5 text-primary" aria-label="Winner" />}
                    <span className="min-w-0 flex-1 truncate">
                      {s.displayName}
                      {self && <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>}
                    </span>
                    <span className="font-mono text-xs tabular-nums">{formatCents(s.equityCents, { whole: true })}</span>
                    <Delta value={s.equityCents - START_CASH_CENTS} kind="money" className="w-28 justify-end text-xs" />
                  </li>
                )
              })}
            </ol>
          )}
        </div>
        <footer className="flex justify-end border-t border-border px-4 py-2">
          <button
            type="button"
            onClick={onHide}
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            View the board
          </button>
        </footer>
      </div>
    </div>
  )
}
