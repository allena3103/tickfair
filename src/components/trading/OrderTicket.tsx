/**
 * Order ticket: buy/sell, limit/market, quantity, and limit price. It shows
 * what the order reserves before you send it, and maps every reject code to
 * a plain sentence. Sending is disabled until the record room is ready, the
 * round is live, and the market socket is connected.
 */

import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { Info } from 'lucide-react'
import { priceBand } from '@/engine/core'
import type { OrderType, Side, Ticker } from '@/shared/contracts'
import { cn } from '@/lib/utils'
import { formatCents, formatPrice, formatQty } from '@/theme/format'
import { placeOrder, transportMessage } from './api'
import { parsePriceInput, parseQtyInput, rejectMessage, ticketReserve } from './logic'

export interface TicketProps {
  ticker: Ticker
  lastCents: number | undefined
  /** Why sending is blocked, or null when it is allowed. */
  blockedReason: string | null
  freeCashCents: number
  freeShares: number
  className?: string
}

type Status = { kind: 'idle' } | { kind: 'sending' } | { kind: 'ok'; batchId: number; orderId: string } | { kind: 'error'; message: string }

export function OrderTicket({ ticker, lastCents, blockedReason, freeCashCents, freeShares, className }: TicketProps) {
  const ids = useId()
  const [side, setSide] = useState<Side>('buy')
  const [type, setType] = useState<OrderType>('limit')
  const [qtyText, setQtyText] = useState('10')
  const [priceText, setPriceText] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  // A new ticker starts from its own last price, not the previous ticker's.
  const [priceFor, setPriceFor] = useState<Ticker | null>(null)
  useEffect(() => {
    if (priceFor !== ticker && lastCents) {
      setPriceText(formatPrice(lastCents).replace(/,/g, ''))
      setPriceFor(ticker)
      setStatus({ kind: 'idle' })
    }
  }, [ticker, lastCents, priceFor])

  const qty = parseQtyInput(qtyText)
  const limitCents = type === 'limit' ? parsePriceInput(priceText) : null
  const reserve = ticketReserve({ side, type, qty: qty ?? 0, limitCents, lastCents: lastCents ?? null })
  const band = lastCents ? priceBand(lastCents) : null

  const inputError =
    qty === null
      ? 'Enter a whole number of shares.'
      : type === 'limit' && limitCents === null
        ? 'Enter a limit price, like 42.10.'
        : type === 'limit' && band && limitCents !== null && (limitCents < band.lo || limitCents > band.hi)
          ? `Price must be within ${formatPrice(band.lo)}–${formatPrice(band.hi)}.`
          : null

  const warning =
    reserve?.kind === 'cash' && reserve.cents > freeCashCents
      ? 'More than your free cash. The exchange will refuse it.'
      : reserve?.kind === 'shares' && reserve.qty > freeShares
        ? 'More than your free shares. The exchange will refuse it.'
        : null

  const canSend = !blockedReason && !inputError && status.kind !== 'sending' && qty !== null

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSend || qty === null) return
    setStatus({ kind: 'sending' })
    const res = await placeOrder(
      type === 'limit' && limitCents !== null ? { ticker, side, type, qty, limitCents } : { ticker, side, type, qty },
    )
    if (res.ok) setStatus({ kind: 'ok', batchId: res.data.batchId, orderId: res.data.orderId })
    else setStatus({ kind: 'error', message: transportMessage(res.code) ?? rejectMessage(res.code) })
  }

  const verb = side === 'buy' ? 'Buy' : 'Sell'
  return (
    <section
      data-testid="order-ticket"
      aria-label="Order ticket"
      className={cn('flex flex-col rounded-lg border border-border bg-card', className)}
    >
      <header className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
        <h2 className="font-mono text-xs font-medium uppercase tracking-wider text-muted-foreground">Order · {ticker}</h2>
      </header>
      <form onSubmit={submit} className="flex flex-col gap-3 p-3" noValidate>
        <Segmented
          label="Side"
          value={side}
          onChange={(v) => setSide(v as Side)}
          options={[
            { value: 'buy', label: 'Buy', active: 'bg-up-muted text-up' },
            { value: 'sell', label: 'Sell', active: 'bg-down-muted text-down' },
          ]}
        />
        <Segmented
          label="Order type"
          value={type}
          onChange={(v) => setType(v as OrderType)}
          options={[
            { value: 'limit', label: 'Limit', active: 'bg-accent text-foreground' },
            { value: 'market', label: 'Market', active: 'bg-accent text-foreground' },
          ]}
        />

        <div className="grid grid-cols-2 gap-2">
          <Field id={`${ids}-qty`} label="Shares">
            <input
              id={`${ids}-qty`}
              data-testid="ticket-qty"
              inputMode="numeric"
              autoComplete="off"
              value={qtyText}
              onChange={(e) => setQtyText(e.target.value)}
              aria-invalid={qty === null}
              className={inputClass}
            />
          </Field>
          <Field id={`${ids}-px`} label={type === 'limit' ? 'Limit $' : 'Price'}>
            {type === 'limit' ? (
              <input
                id={`${ids}-px`}
                data-testid="ticket-price"
                inputMode="decimal"
                autoComplete="off"
                value={priceText}
                onChange={(e) => setPriceText(e.target.value)}
                aria-invalid={limitCents === null}
                className={inputClass}
              />
            ) : (
              <div id={`${ids}-px`} className={cn(inputClass, 'flex items-center text-muted-foreground')}>
                best in batch
              </div>
            )}
          </Field>
        </div>

        <dl className="space-y-1 font-mono text-xs">
          <Row label="Band">{band ? `${formatPrice(band.lo)} – ${formatPrice(band.hi)}` : '—'}</Row>
          <Row label="Reserves" testId="ticket-reserve">
            {reserve === null
              ? '—'
              : reserve.kind === 'cash'
                ? `${formatCents(reserve.cents)}${type === 'market' ? ' max' : ''}`
                : `${formatQty(reserve.qty)} ${ticker}`}
          </Row>
          <Row label={side === 'buy' ? 'Free cash' : 'Free shares'}>
            {side === 'buy' ? formatCents(freeCashCents) : `${formatQty(freeShares)} ${ticker}`}
          </Row>
        </dl>

        {(inputError || warning) && !blockedReason && (
          <p className="text-xs text-muted-foreground" data-testid="ticket-hint">
            {inputError ?? warning}
          </p>
        )}

        <button
          type="submit"
          data-testid="ticket-submit"
          disabled={!canSend}
          aria-busy={status.kind === 'sending' || undefined}
          className="h-10 rounded-md bg-primary text-sm font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:cursor-not-allowed disabled:opacity-40"
        >
          {status.kind === 'sending' ? 'Sending…' : `${verb} ${qty ? formatQty(qty) : ''} ${ticker}`.replace(/\s+/g, ' ')}
        </button>

        <div aria-live="polite" className="min-h-4 text-xs">
          {blockedReason ? (
            <p data-testid="ticket-blocked" className="text-muted-foreground">
              {blockedReason}
            </p>
          ) : status.kind === 'error' ? (
            <p data-testid="ticket-error" role="alert" className="text-destructive">
              {status.message}
            </p>
          ) : status.kind === 'ok' ? (
            <p data-testid="ticket-ok" data-order-id={status.orderId} className="text-foreground">
              Order in for batch <span className="font-mono tabular-nums">#{status.batchId}</span>.
            </p>
          ) : null}
        </div>

        <p className="flex gap-1.5 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground" data-testid="fairness-hint">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            Orders in the same 1-second batch are treated as simultaneous.{' '}
            <Link to="/#how-it-works" className="text-foreground underline underline-offset-2 hover:text-primary">
              How it works
            </Link>
          </span>
        </p>
      </form>
    </section>
  )
}

const inputClass =
  'h-9 w-full rounded-md border border-input bg-background px-2.5 font-mono text-sm tabular-nums outline-none focus-visible:ring-1 focus-visible:ring-ring aria-[invalid=true]:border-destructive'

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  )
}

function Row({ label, testId, children }: { label: string; testId?: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums" data-testid={testId}>
        {children}
      </dd>
    </div>
  )
}

function Segmented({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string; active: string }[]
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-2 gap-1 rounded-md border border-border bg-background p-0.5">
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            data-testid={`ticket-${o.value}`}
            onClick={() => onChange(o.value)}
            className={cn(
              'h-8 rounded-sm text-sm font-medium outline-none focus-visible:ring-1 focus-visible:ring-ring',
              on ? o.active : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
