/**
 * Shared chrome for the dense board panels (news, tape, leaderboard, online):
 * a titled card plus compact loading, empty, and error states.
 */

import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { EmptyState } from '@/components/ui'
import { cn } from '@/lib/utils'

export function FeedPanel({
  title,
  meta,
  testId,
  className,
  children,
}: {
  title: string
  meta?: ReactNode
  testId: string
  className?: string
  children: ReactNode
}) {
  return (
    <section
      data-testid={testId}
      aria-label={title}
      className={cn('flex min-h-0 flex-col rounded-lg border border-border bg-card', className)}
    >
      <header className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
        <h2 className="font-mono text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</h2>
        {meta != null && <span className="font-mono text-xs text-muted-foreground">{meta}</span>}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  )
}

/** Pulse rows shaped like a list of dense rows. */
export function FeedSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div data-state="loading" aria-busy="true" aria-label="Loading" className="space-y-2 p-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-5 animate-pulse rounded-md bg-muted" style={{ width: `${92 - (i % 3) * 14}%` }} />
      ))}
    </div>
  )
}

export function FeedEmpty({ icon, title, description }: { icon: ReactNode; title: string; description?: string }) {
  return (
    <div data-state="empty">
      <EmptyState icon={icon} title={title} description={description} className="py-8" />
    </div>
  )
}

export function FeedError({ message, icon }: { message: string; icon?: ReactNode }) {
  return (
    <div
      data-state="error"
      role="alert"
      className="flex items-start gap-2 border-b border-border px-3 py-2 text-xs text-destructive [&_svg]:mt-0.5 [&_svg]:size-3.5 [&_svg]:shrink-0"
    >
      {icon ?? <AlertTriangle />}
      <span>{message}</span>
    </div>
  )
}
