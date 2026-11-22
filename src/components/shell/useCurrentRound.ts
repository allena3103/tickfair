import { useQuery, type RecordData } from 'deepspace'
import type { RoundRecord } from '@/shared/contracts'

export interface CurrentRound {
  /** The most recently started round (live, or done during the break). */
  round: RecordData<RoundRecord> | null
  status: 'loading' | 'ready' | 'error'
  error?: string
}

/**
 * The latest round from the `rounds` collection. The engine writes a round
 * record when it starts (status `live`) and updates it at the end (`done`),
 * so the newest `startsAt` is the current round, or the one whose results
 * are showing during the break.
 */
/**
 * Matches no record. Feeds scoped to "the current round" query with this when
 * no round resolves, so they show nothing rather than every round's data.
 */
export const NO_ROUND = '__no_round__'

/**
 * The round id a round-scoped feed should query, and the status to show:
 * an explicit `roundId` wins; otherwise the current round, with its loading
 * or error state taking precedence over the feed's own query status.
 */
export function resolveFeedRound(
  explicit: string | undefined,
  current: CurrentRound,
): { roundId: string; pending: boolean; error?: string } {
  if (explicit) return { roundId: explicit, pending: false }
  if (current.status === 'loading') return { roundId: NO_ROUND, pending: true }
  if (current.status === 'error') return { roundId: NO_ROUND, pending: false, error: current.error || 'Could not load the current round.' }
  return { roundId: current.round?.recordId ?? NO_ROUND, pending: false }
}

/** Combine a feed's query status with its round resolution. */
export function feedStatus(
  feed: { pending: boolean; error?: string },
  query: { status: 'loading' | 'ready' | 'error'; error?: string },
): { status: 'loading' | 'ready' | 'error'; error?: string } {
  if (feed.pending) return { status: 'loading' }
  if (feed.error) return { status: 'error', error: feed.error }
  return { status: query.status, error: query.error }
}

/**
 * Ordered + limited, because rounds accumulate. The SDK re-subscribes such a
 * query on each rounds change, but a round is written only at start and end.
 */
const CURRENT_ROUND_QUERY = { orderBy: 'startsAt', orderDir: 'desc', limit: 1 } as const

export function useCurrentRound(): CurrentRound {
  const { records, status, error } = useQuery<RoundRecord>('rounds', CURRENT_ROUND_QUERY)
  const round = latest(records)
  return { round, status, error }
}

function latest(records: RecordData<RoundRecord>[]): RecordData<RoundRecord> | null {
  let best: RecordData<RoundRecord> | null = null
  for (const r of records) if (!best || r.data.startsAt > best.data.startsAt) best = r
  return best
}
