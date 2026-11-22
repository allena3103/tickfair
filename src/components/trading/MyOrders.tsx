/**
 * The signed-in trader's own rows: open orders (with cancel), fills, and
 * positions with P&L. `orders` and `fills` are 'own'-read collections, so
 * nobody else's rows ever reach this browser.
 */

import { useState } from 'react'
import { ListOrdered, Receipt, Wallet } from 'lucide-react'
import type { FillRecord, OrderRecord, Ticker } from '@/shared/contracts'
import { cn } from '@/lib/utils'
import { FeedEmpty, FeedError, FeedPanel, FeedSkeleton } from '@/components/feed/FeedPanel'
import { Delta } from '@/theme/Delta'
import { formatCents, formatPrice, formatQty } from '@/theme/format'
import { cancelOrder, transportMessage } from './api'
import { rejectMessage, remainingQty, type PortfolioView } from './logic'

type LoadStatus = 'loading' | 'ready' | 'error'

export interface OrderRow extends OrderRecord {
  id: string
}

export interface FillRow extends FillRecord {
  id: string
}

const sideClass = (side: string) => (side === 'buy' ? 'text-up' : 'text-down')

export function OpenOrders({
  orders,
  status,
  error,
  canCancel,
  className,
}: {
  orders: OrderRow[]
  status: LoadStatus
  error?: string
  canCancel: boolean
  className?: string
}) {
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [failure, setFailure] = useState<string | null>(null)

  async function cancel(id: string) {
    setFailure(null)
    setPending((p) => ({ ...p, [id]: true }))
    const res = await cancelOrder({ orderId: id })
    if (!res.ok) {
      setFailure(transportMessage(res.code) ?? rejectMessage(res.code))
      setPending((p) => ({ ...p, [id]: false }))
    }
    // On success the mirrored record flips to cancelled and the row leaves.
  }

  return (
    <FeedPanel
      testId="open-orders"
      title="Open orders"
      meta={status === 'ready' && orders.length > 0 ? `${orders.length} open` : undefined}
      className={className}
    >
      {status === 'error' && <FeedError message={error || 'Could not load your orders.'} />}
      {failure && <FeedError message={failure} />}
      {status === 'loading' ? (
        <FeedSkeleton rows={3} />
      ) : orders.length === 0 ? (
        status === 'ready' && <FeedEmpty icon={<ListOrdered />} title="No open orders" description="Resting orders show here until they fill." />
      ) : (
        <table className="w-full font-mono text-xs tabular-nums">
          <thead className="sticky top-0 bg-card">
            <tr className="text-muted-foreground">
              <th scope="col" className="px-3 py-1.5 text-left font-normal">Sym</th>
              <th scope="col" className="py-1.5 text-left font-normal">Side</th>
              <th scope="col" className="py-1.5 text-right font-normal">Left</th>
              <th scope="col" className="py-1.5 text-right font-normal">Limit</th>
              <th scope="col" className="px-3 py-1.5 text-right font-normal"><span className="sr-only">Cancel</span></th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} data-testid="open-order" data-order-id={o.id} className="border-t border-border">
                <td className="px-3 py-1">{o.ticker}</td>
                <td className={cn('py-1 uppercase', sideClass(o.side))}>
                  {o.side}
                  {o.type === 'market' && <span className="ml-1 text-muted-foreground">mkt</span>}
                </td>
                <td className="py-1 text-right">
                  {formatQty(remainingQty(o))}
                  {o.filledQty > 0 && <span className="text-muted-foreground">/{formatQty(o.qty)}</span>}
                </td>
                <td className="py-1 text-right">{formatPrice(o.limitCents)}</td>
                <td className="px-3 py-1 text-right">
                  <button
                    type="button"
                    data-testid="cancel-order"
                    disabled={!canCancel || pending[o.id]}
                    onClick={() => cancel(o.id)}
                    aria-label={`Cancel ${o.side} ${remainingQty(o)} ${o.ticker} at ${formatPrice(o.limitCents)}`}
                    className="rounded-sm border border-border px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {pending[o.id] ? '…' : 'Cancel'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </FeedPanel>
  )
}

export function MyFills({ fills, status, error, className }: { fills: FillRow[]; status: LoadStatus; error?: string; className?: string }) {
  return (
    <FeedPanel testId="my-fills" title="My fills" meta={status === 'ready' && fills.length > 0 ? `${fills.length}` : undefined} className={className}>
      {status === 'error' && <FeedError message={error || 'Could not load your fills.'} />}
      {status === 'loading' ? (
        <FeedSkeleton rows={3} />
      ) : fills.length === 0 ? (
        status === 'ready' && <FeedEmpty icon={<Receipt />} title="No fills yet" description="Each batch that fills your order adds a row." />
      ) : (
        <table className="w-full font-mono text-xs tabular-nums">
          <thead className="sticky top-0 bg-card">
            <tr className="text-muted-foreground">
              <th scope="col" className="px-3 py-1.5 text-left font-normal">Batch</th>
              <th scope="col" className="py-1.5 text-left font-normal">Sym</th>
              <th scope="col" className="py-1.5 text-left font-normal">Side</th>
              <th scope="col" className="py-1.5 text-right font-normal">Shares</th>
              <th scope="col" className="px-3 py-1.5 text-right font-normal">Price</th>
            </tr>
          </thead>
          <tbody>
            {fills.map((f) => (
              <tr key={f.id} data-testid="fill-row" data-order-id={f.orderId} className="border-t border-border">
                <td className="px-3 py-1 text-muted-foreground">#{f.batchId}</td>
                <td className="py-1">{f.ticker}</td>
                <td className={cn('py-1 uppercase', sideClass(f.side))}>{f.side}</td>
                <td className="py-1 text-right">{formatQty(f.qty)}</td>
                <td className="px-3 py-1 text-right">{formatPrice(f.priceCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </FeedPanel>
  )
}

export function Positions({
  view,
  status,
  error,
  active,
  className,
}: {
  view: PortfolioView
  status: LoadStatus
  error?: string
  active: Ticker
  className?: string
}) {
  return (
    <FeedPanel testId="positions" title="Positions" className={className}>
      {status === 'error' && <FeedError message={error || 'Could not load your portfolio.'} />}
      {status === 'loading' ? (
        <FeedSkeleton rows={4} />
      ) : (
        <div>
          <dl className="grid grid-cols-2 gap-px border-b border-border bg-border font-mono text-xs">
            <Stat label="Equity" testId="my-equity">{formatCents(view.equityCents)}</Stat>
            <Stat label="P&L" testId="my-pnl">
              <Delta value={view.pnlCents} kind="money" />
            </Stat>
            <Stat label="Cash">{formatCents(view.cashCents)}</Stat>
            <Stat label="Free cash" testId="my-free-cash">{formatCents(view.freeCashCents)}</Stat>
          </dl>
          {view.rows.every((r) => r.qty === 0) ? (
            <FeedEmpty icon={<Wallet />} title="No shares held" description="You start each round with $100,000 in cash." />
          ) : (
            <table className="w-full font-mono text-xs tabular-nums">
              <thead>
                <tr className="text-muted-foreground">
                  <th scope="col" className="px-3 py-1.5 text-left font-normal">Sym</th>
                  <th scope="col" className="py-1.5 text-right font-normal">Shares</th>
                  <th scope="col" className="py-1.5 text-right font-normal">Last</th>
                  <th scope="col" className="px-3 py-1.5 text-right font-normal">Value</th>
                </tr>
              </thead>
              <tbody>
                {view.rows
                  .filter((r) => r.qty !== 0)
                  .map((r) => (
                    <tr key={r.ticker} data-testid="position-row" data-ticker={r.ticker} className={cn('border-t border-border', r.ticker === active && 'bg-accent')}>
                      <td className="px-3 py-1">{r.ticker}</td>
                      <td className="py-1 text-right">{formatQty(r.qty)}</td>
                      <td className="py-1 text-right">{r.lastCents ? formatPrice(r.lastCents) : '—'}</td>
                      <td className="px-3 py-1 text-right">{formatCents(r.valueCents)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </FeedPanel>
  )
}

function Stat({ label, testId, children }: { label: string; testId?: string; children: React.ReactNode }) {
  return (
    <div className="bg-card px-3 py-2">
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm tabular-nums" data-testid={testId}>
        {children}
      </dd>
    </div>
  )
}
