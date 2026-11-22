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
export function useCurrentRound(): CurrentRound {
  const { records, status, error } = useQuery<RoundRecord>('rounds', {
    orderBy: 'startsAt',
    orderDir: 'desc',
    limit: 1,
  })
  const round = latest(records)
  return { round, status, error }
}

function latest(records: RecordData<RoundRecord>[]): RecordData<RoundRecord> | null {
  let best: RecordData<RoundRecord> | null = null
  for (const r of records) if (!best || r.data.startsAt > best.data.startsAt) best = r
  return best
}
