/**
 * The batch sweep (docs/design/direction.md, signature element): a bar that
 * fills toward the next batch boundary and snaps, plus the round countdown.
 * The sweep and the tenths readout are driven by requestAnimationFrame on
 * refs, so the page doesn't re-render ten times a second. Under reduced
 * motion the bar stays still and only the numbers update.
 */

import { useEffect, useRef } from 'react'
import { BATCH_MS, type Phase } from '@/shared/contracts'
import { cn } from '@/lib/utils'
import { formatClock } from '@/theme/format'
import { useNow } from '@/components/shell/useNow'

export function BatchClock({
  connected,
  synced,
  phase,
  phaseEndsAt,
  batchId,
  nextBatchAt,
  className,
}: {
  connected: boolean
  synced: boolean
  phase: Phase | null
  phaseEndsAt: number
  batchId: number
  nextBatchAt: number
  className?: string
}) {
  const now = useNow(1000)
  const bar = useRef<HTMLDivElement>(null)
  const label = useRef<HTMLSpanElement>(null)
  const live = connected && phase === 'live'

  useEffect(() => {
    if (!live) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    let raf = 0
    let lastText = ''
    const frame = () => {
      const left = Math.max(0, nextBatchAt - Date.now())
      const text = `${(Math.ceil(left / 100) / 10).toFixed(1)}s`
      if (label.current && text !== lastText) {
        label.current.textContent = text
        lastText = text
      }
      if (bar.current && !reduce) bar.current.style.transform = `scaleX(${1 - Math.min(1, left / BATCH_MS)})`
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [live, nextBatchAt])

  const state = !synced ? 'connecting' : !connected ? 'reconnecting' : (phase ?? 'connecting')

  return (
    <div
      data-testid="batch-clock"
      data-phase={state}
      className={cn('flex items-center gap-4 rounded-lg border border-border bg-card px-3 py-2', className)}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2 font-mono text-xs">
          <span className="uppercase tracking-wider text-muted-foreground">
            {state === 'live' ? (
              <>
                Batch <span className="tabular-nums text-foreground" data-testid="batch-id">#{batchId}</span>
              </>
            ) : state === 'break' ? (
              'Results break'
            ) : state === 'reconnecting' ? (
              'Reconnecting'
            ) : (
              'Connecting'
            )}
          </span>
          {state === 'live' && (
            <span className="text-muted-foreground">
              clears in <span ref={label} className="tabular-nums text-foreground" data-testid="batch-countdown" />
            </span>
          )}
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-sm bg-muted" aria-hidden>
          <div
            ref={bar}
            className={cn('h-full origin-left bg-primary', state !== 'live' && 'opacity-0')}
            style={{ transform: 'scaleX(0)' }}
          />
        </div>
      </div>
      <div className="shrink-0 border-l border-border pl-4 text-right">
        <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          {state === 'break' ? 'Next round' : 'Round ends'}
        </div>
        <div className="font-mono text-base tabular-nums" data-testid="round-countdown">
          {(state === 'live' || state === 'break') && phaseEndsAt > 0 ? formatClock(phaseEndsAt - now) : '–:––'}
        </div>
      </div>
    </div>
  )
}
