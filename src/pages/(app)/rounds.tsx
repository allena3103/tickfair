/**
 * /rounds: finished rounds, newest first, with the winner, duration, and
 * final standings. Public (`rounds` is readable by everyone).
 */

import { useMemo } from 'react'
import { useAuthStatus, useQuery } from 'deepspace'
import type { RoundRecord } from '@/shared/contracts'
import { RoundsView } from '@/components/feed/RoundsList'

/** Rounds accumulate, so this one keeps orderBy + limit; rounds change only twice a round. */
const PAST_ROUNDS_QUERY = { where: { status: 'done' }, orderBy: 'endsAt', orderDir: 'desc', limit: 50 } as const

export default function RoundsPage() {
  const { userId } = useAuthStatus()
  const { records, status, error } = useQuery<RoundRecord>('rounds', PAST_ROUNDS_QUERY)
  const rounds = useMemo(
    () =>
      records
        .filter((r) => r.data.status === 'done')
        .map((r) => ({ id: r.recordId, ...r.data }))
        .sort((a, b) => b.endsAt - a.endsAt),
    [records],
  )
  return (
    <div className="mx-auto max-w-4xl p-4">
      <h1 className="text-2xl font-semibold tracking-tight">Past rounds</h1>
      <p className="mt-1 text-sm text-muted-foreground">Every 15-minute round, its winner, and the final standings.</p>
      <div className="mt-6">
        <RoundsView rounds={rounds} status={status} error={error} currentUserId={userId} />
      </div>
    </div>
  )
}
