/**
 * Subscription options for the hot feeds (tape, news, portfolios).
 *
 * The SDK's record socket re-sends a full `core.subscribe` for every
 * subscription that has `orderBy` or `limit` each time any record in that
 * collection changes. With a tape print every second, an ordered/limited tape
 * query re-subscribed about once a second. With only an equality `where`, the
 * SDK applies each change locally instead, so these feeds query by round (and
 * ticker), which already bounds them, and sort and slice on the client.
 *
 * Rounds queries keep `orderBy` + `limit`: rounds accumulate forever, and a
 * round record is written only at its start and end.
 */

import type { Ticker } from '@/shared/contracts'

export interface FeedQuery {
  where: Record<string, unknown>
  orderBy?: string
  orderDir?: 'asc' | 'desc'
  limit?: number
}

export function tapeQuery(roundId: string, ticker?: Ticker): FeedQuery {
  return { where: ticker ? { roundId, ticker } : { roundId } }
}

export function newsQuery(roundId: string): FeedQuery {
  return { where: { roundId } }
}

export function portfoliosQuery(roundId: string): FeedQuery {
  return { where: { roundId } }
}
