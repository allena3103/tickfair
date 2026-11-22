/**
 * Header round status, from the `rounds` collection: live with time left,
 * results break with time to the next round, or no round yet. The terminal
 * shows the exact batch countdown from the exchange stream; this is the
 * coarse, always-on version for every page.
 */

import { ROUND_BREAK_MS } from '@/shared/contracts'
import { cn } from '@/lib/utils'
import { formatClock } from '@/theme/format'
import { useCurrentRound } from './useCurrentRound'
import { useNow } from './useNow'

export type RoundPhaseView =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'live'; msLeft: number }
  | { kind: 'break'; msLeft: number }

/** Pure: what the pill shows for a round at `now`. */
export function roundPhase(
  round: { status: 'live' | 'done'; endsAt: number } | null,
  now: number,
  loading: boolean,
): RoundPhaseView {
  if (loading) return { kind: 'loading' }
  if (!round) return { kind: 'none' }
  if (round.status === 'live' && round.endsAt > now) return { kind: 'live', msLeft: round.endsAt - now }
  // Ended (or past its end and not yet marked done): next round starts after the break.
  return { kind: 'break', msLeft: Math.max(0, round.endsAt + ROUND_BREAK_MS - now) }
}

export function RoundStatus({ className }: { className?: string }) {
  const { round, status } = useCurrentRound()
  const now = useNow(1000)
  const view = roundPhase(round ? round.data : null, now, status === 'loading')
  return <RoundStatusView view={view} className={className} />
}

export function RoundStatusView({ view, className }: { view: RoundPhaseView; className?: string }) {
  if (view.kind === 'loading') {
    return <div aria-hidden className={cn('h-6 w-28 animate-pulse rounded-md bg-muted', className)} />
  }
  const label =
    view.kind === 'live' ? 'Live' : view.kind === 'break' ? (view.msLeft > 0 ? 'Results' : 'Starting') : 'No round'
  return (
    <div
      data-testid="round-status"
      data-phase={view.kind}
      className={cn(
        'inline-flex h-6 items-center gap-2 rounded-md border border-border px-2 font-mono text-xs',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          view.kind === 'live' ? 'bg-up' : view.kind === 'break' ? 'bg-primary' : 'bg-muted-foreground',
        )}
      />
      <span className="uppercase tracking-wider text-muted-foreground">{label}</span>
      {(view.kind === 'live' || (view.kind === 'break' && view.msLeft > 0)) && (
        <span className="tabular-nums text-foreground" aria-label={view.kind === 'live' ? 'time left' : 'next round in'}>
          {formatClock(view.msLeft)}
        </span>
      )}
    </div>
  )
}
