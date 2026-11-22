/**
 * Finished-round list for /rounds: winner, duration, and expandable final
 * standings. Pure view; the page owns the query.
 */

import { useState } from 'react'
import { ChevronDown, History, Trophy } from 'lucide-react'
import { cn } from '@/lib/utils'
import { START_CASH_CENTS, type RoundRecord, type Standing } from '@/shared/contracts'
import { isBotId } from '@/components/shell/tickers'
import { Delta } from '@/theme/Delta'
import { formatCents, formatClock } from '@/theme/format'
import { FeedEmpty, FeedError, FeedSkeleton } from './FeedPanel'

export interface RoundItem extends RoundRecord {
  id: string
}

/** Standings without bots, best equity first. */
export function humanStandings(standings: unknown): Standing[] {
  const list = Array.isArray(standings) ? (standings as Standing[]) : parseList(standings)
  return list
    .filter((s) => s && typeof s.userId === 'string' && !isBotId(s.userId))
    .sort((a, b) => b.equityCents - a.equityCents)
}

function parseList(raw: unknown): Standing[] {
  if (typeof raw !== 'string') return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export function RoundsView({
  rounds,
  status,
  error,
  currentUserId,
}: {
  rounds: RoundItem[]
  status: 'loading' | 'ready' | 'error'
  error?: string
  currentUserId?: string | null
}) {
  if (status === 'loading') {
    return (
      <div data-testid="rounds-list" className="rounded-lg border border-border bg-card">
        <FeedSkeleton rows={5} />
      </div>
    )
  }
  return (
    <div data-testid="rounds-list" className="rounded-lg border border-border bg-card">
      {status === 'error' && <FeedError message={error || 'Could not load past rounds.'} />}
      {rounds.length === 0 ? (
        status === 'ready' && (
          <FeedEmpty
            icon={<History />}
            title="No finished rounds yet"
            description="A round ends every 15 minutes. Its winner shows up here."
          />
        )
      ) : (
        <ul className="divide-y divide-border">
          {rounds.map((r) => (
            <RoundRow key={r.id} round={r} currentUserId={currentUserId} />
          ))}
        </ul>
      )}
    </div>
  )
}

function RoundRow({ round, currentUserId }: { round: RoundItem; currentUserId?: string | null }) {
  const [open, setOpen] = useState(false)
  const standings = humanStandings(round.standings)
  // standings are best-first, so if winnerId is missing, stale, or a bot,
  // the top human standing is the winner shown.
  const winner = standings.find((s) => s.userId === round.winnerId) ?? standings[0] ?? null
  const ended = new Date(round.endsAt)
  const panelId = `round-${round.id}`
  return (
    <li data-testid="round-row">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="grid w-full grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-accent sm:grid-cols-[9rem_1fr_auto_auto]"
      >
        <span className="font-mono text-xs text-muted-foreground">
          {ended.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{' '}
          {ended.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
        </span>
        <span className="flex min-w-0 items-center gap-2 text-sm">
          <Trophy className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
          {winner ? (
            <>
              <span className="truncate font-medium">{winner.displayName}</span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {formatCents(winner.equityCents, { whole: true })}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">No human traders</span>
          )}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {formatClock(round.endsAt - round.startsAt)} · {standings.length} traders
        </span>
        <ChevronDown
          aria-hidden
          className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div id={panelId} className="border-t border-border bg-background px-4 py-2">
          {standings.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">Nobody traded this round.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="font-mono text-xs text-muted-foreground">
                  <th scope="col" className="w-10 py-1.5 text-left font-normal">
                    #
                  </th>
                  <th scope="col" className="py-1.5 text-left font-normal">
                    Trader
                  </th>
                  <th scope="col" className="py-1.5 text-right font-normal">
                    Final equity
                  </th>
                  <th scope="col" className="py-1.5 text-right font-normal">
                    P&amp;L
                  </th>
                </tr>
              </thead>
              <tbody>
                {standings.map((s, i) => {
                  const pnl = s.equityCents - START_CASH_CENTS
                  const self = s.userId === currentUserId
                  return (
                    <tr key={s.userId} className={cn('border-t border-border', self && 'bg-accent')}>
                      <td className="py-1.5 font-mono tabular-nums text-muted-foreground">{i + 1}</td>
                      <td className="py-1.5">
                        {s.displayName}
                        {self && <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>}
                      </td>
                      <td className="py-1.5 text-right font-mono tabular-nums">
                        {formatCents(s.equityCents, { whole: true })}
                      </td>
                      <td className="py-1.5 text-right">
                        <Delta value={pnl} kind="money" />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </li>
  )
}
