/**
 * Headlines for the current round, newest first. News lands before its
 * price effect (PLAN §6), so the freshest item is flagged.
 */

import { useMemo } from 'react'
import { useQuery } from 'deepspace'
import { Newspaper } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { NewsRecord } from '@/shared/contracts'
import { formatRelativeTime } from '@/theme/format'
import { useCurrentRound } from '../shell/useCurrentRound'
import { useNow } from '../shell/useNow'
import { FeedEmpty, FeedError, FeedPanel, FeedSkeleton } from './FeedPanel'

/** A headline this recent gets the "new" marker. */
const FRESH_MS = 60_000

export interface NewsItem extends NewsRecord {
  id: string
}

export function NewsFeed({ roundId, limit = 30, className }: { roundId?: string; limit?: number; className?: string }) {
  const current = useCurrentRound()
  const round = roundId ?? current.round?.recordId
  const { records, status, error } = useQuery<NewsRecord>('news', {
    where: round ? { roundId: round } : {},
    orderBy: 'publishedAt',
    orderDir: 'desc',
    limit,
  })
  const items = useMemo(
    () =>
      records
        .map((r) => ({ ...r.data, id: r.recordId }))
        .sort((a, b) => b.publishedAt - a.publishedAt || b.id.localeCompare(a.id))
        .slice(0, limit),
    [records, limit],
  )
  const now = useNow(15_000)
  const waiting = !roundId && current.status === 'loading'
  return (
    <NewsFeedView
      items={items}
      now={now}
      status={waiting ? 'loading' : status}
      error={error ?? current.error}
      className={className}
    />
  )
}

export function NewsFeedView({
  items,
  now,
  status,
  error,
  className,
}: {
  items: NewsItem[]
  now: number
  status: 'loading' | 'ready' | 'error'
  error?: string
  className?: string
}) {
  return (
    <FeedPanel testId="news-feed" title="News" className={className}>
      {status === 'error' && <FeedError message={error || 'Could not load the news.'} />}
      {status === 'loading' ? (
        <FeedSkeleton rows={4} />
      ) : items.length === 0 ? (
        status === 'ready' && (
          <FeedEmpty
            icon={<Newspaper />}
            title="No news this round"
            description="Headlines land here a moment before prices react."
          />
        )
      ) : (
        <ul className="divide-y divide-border">
          {items.map((n) => {
            const fresh = now - n.publishedAt < FRESH_MS
            return (
              <li
                key={n.id}
                data-testid="news-item"
                className={cn('border-l-2 px-3 py-2.5', fresh ? 'border-l-primary' : 'border-l-transparent')}
              >
                <div className="flex items-center gap-2 font-mono text-xs">
                  <span className="rounded-sm border border-border px-1.5 text-foreground">{n.ticker}</span>
                  {fresh && <span className="uppercase tracking-wider text-primary">new</span>}
                  <time className="ml-auto text-muted-foreground" dateTime={new Date(n.publishedAt).toISOString()}>
                    {formatRelativeTime(n.publishedAt, now)}
                  </time>
                </div>
                <p className="mt-1 text-sm font-medium leading-snug">{n.headline}</p>
                {n.body && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{n.body}</p>}
              </li>
            )
          })}
        </ul>
      )}
    </FeedPanel>
  )
}
