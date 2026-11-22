/**
 * Ticker tabs: symbol, last price, and change since the round opened.
 * Switching a tab also publishes the ticker to floor presence (the page does that).
 */

import { TICKERS, type Ticker } from '@/shared/contracts'
import { TICKER_INFO } from '@/components/shell/tickers'
import { cn } from '@/lib/utils'
import { Delta } from '@/theme/Delta'
import { formatPrice } from '@/theme/format'

export function TickerTabs({
  active,
  onChange,
  last,
  open,
}: {
  active: Ticker
  onChange: (t: Ticker) => void
  last: Partial<Record<Ticker, number>>
  open: Partial<Record<Ticker, number>>
}) {
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = TICKERS[(i + step + TICKERS.length) % TICKERS.length]
    onChange(next)
    document.getElementById(`ticker-tab-${next}`)?.focus()
  }
  return (
    <div
      role="tablist"
      aria-label="Stocks"
      data-testid="ticker-tabs"
      className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border"
    >
      {TICKERS.map((t, i) => {
        const px = last[t]
        const o = open[t]
        const selected = t === active
        return (
          <button
            key={t}
            id={`ticker-tab-${t}`}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            data-testid={`ticker-tab-${t}`}
            onClick={() => onChange(t)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              'relative flex min-w-0 items-baseline justify-between gap-2 bg-card px-3 py-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
              selected ? 'bg-accent' : 'hover:bg-accent/60',
            )}
          >
            {selected && <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-primary" />}
            <span className="min-w-0">
              <span className="block font-mono text-sm font-semibold">{t}</span>
              <span className="hidden truncate text-xs text-muted-foreground sm:block">{TICKER_INFO[t].name}</span>
            </span>
            <span className="text-right">
              <span className="block font-mono text-sm tabular-nums">{px ? formatPrice(px) : '—'}</span>
              {px && o ? (
                <Delta value={(px - o) / o} kind="percent" className="text-[11px]" />
              ) : (
                <span className="block font-mono text-[11px] text-muted-foreground">&nbsp;</span>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}
