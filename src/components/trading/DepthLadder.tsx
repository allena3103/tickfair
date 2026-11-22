/**
 * Depth ladder: aggregated price levels (no identities), asks above the
 * spread and bids below, with a tinted bar behind each quantity.
 */

import { Layers } from 'lucide-react'
import type { Depth, Ticker } from '@/shared/contracts'
import { FeedEmpty, FeedError, FeedPanel, FeedSkeleton } from '@/components/feed/FeedPanel'
import { formatPrice, formatQty } from '@/theme/format'
import { ladderRows } from './logic'

export function DepthLadder({
  ticker,
  depth,
  lastCents,
  status,
  className,
}: {
  ticker: Ticker
  depth: Depth | undefined
  lastCents: number | undefined
  status: 'loading' | 'ready' | 'error' | 'closed'
  className?: string
}) {
  const { asks, bids, maxQty, spreadCents } = ladderRows(depth)
  const empty = asks.length === 0 && bids.length === 0
  return (
    <FeedPanel testId="depth-ladder" title={`Book · ${ticker}`} className={className}>
      {status === 'error' && <FeedError message="Lost the market feed. Reconnecting." />}
      {status === 'loading' ? (
        <FeedSkeleton rows={8} />
      ) : status === 'closed' ? (
        <FeedEmpty icon={<Layers />} title="Book closed" description="The book opens with the next round." />
      ) : empty ? (
        <FeedEmpty icon={<Layers />} title="No resting orders" description="Bids and asks show here between batches." />
      ) : (
        <table className="w-full font-mono text-xs tabular-nums" aria-label={`${ticker} order book`}>
          <thead className="sticky top-0 bg-card">
            <tr className="text-muted-foreground">
              <th scope="col" className="px-3 py-1.5 text-left font-normal">
                Price
              </th>
              <th scope="col" className="px-3 py-1.5 text-right font-normal">
                Shares
              </th>
            </tr>
          </thead>
          <tbody>
            {asks.map(([px, qty]) => (
              <Level key={`a${px}`} side="ask" price={px} qty={qty} max={maxQty} />
            ))}
            <tr className="border-y border-border bg-background" data-testid="ladder-spread">
              <td className="px-3 py-1.5 text-sm text-foreground">{lastCents ? formatPrice(lastCents) : '—'}</td>
              <td className="px-3 py-1.5 text-right text-muted-foreground">
                {/* Orders wait for the next batch, so the book can cross until it clears. */}
                {spreadCents === null ? 'last' : spreadCents > 0 ? `spread ${formatPrice(spreadCents)}` : 'crosses next batch'}
              </td>
            </tr>
            {bids.map(([px, qty]) => (
              <Level key={`b${px}`} side="bid" price={px} qty={qty} max={maxQty} />
            ))}
          </tbody>
        </table>
      )}
    </FeedPanel>
  )
}

function Level({ side, price, qty, max }: { side: 'bid' | 'ask'; price: number; qty: number; max: number }) {
  const pct = Math.max(2, Math.round((qty / max) * 100))
  return (
    <tr data-testid={`ladder-${side}`} className="relative">
      <td className={`px-3 py-1 ${side === 'bid' ? 'text-up' : 'text-down'}`}>
        <span className="sr-only">{side === 'bid' ? 'Bid ' : 'Ask '}</span>
        {formatPrice(price)}
      </td>
      <td className="relative px-3 py-1 text-right">
        <span
          aria-hidden
          className={`absolute inset-y-0.5 right-0 ${side === 'bid' ? 'bg-up-muted' : 'bg-down-muted'}`}
          style={{ width: `${pct}%` }}
        />
        <span className="relative">{formatQty(qty)}</span>
      </td>
    </tr>
  )
}
