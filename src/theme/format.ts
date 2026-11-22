/**
 * Number and time formatting for the board. Money is integer cents and
 * quantities are whole shares (see src/shared/contracts.ts).
 */

const MINUS = '−' // typographic minus, same width as "+" in Plex Mono

const usd = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const usdWhole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

/** 1234567 → "$12,345.67". Negative values get a typographic minus. */
export function formatCents(cents: number, opts: { whole?: boolean } = {}): string {
  if (!Number.isFinite(cents)) return '—'
  const dollars = Math.abs(cents) / 100
  const body = opts.whole ? usdWhole.format(Math.round(dollars)) : usd.format(dollars)
  return `${cents < 0 ? MINUS : ''}$${body}`
}

/** A price without the dollar sign, for dense columns: 4210 → "42.10". */
export function formatPrice(cents: number): string {
  if (!Number.isFinite(cents)) return '—'
  return `${cents < 0 ? MINUS : ''}${usd.format(Math.abs(cents) / 100)}`
}

/** Shares: 12500 → "12,500". */
export function formatQty(qty: number): string {
  if (!Number.isFinite(qty)) return '—'
  return int.format(qty)
}

export type Direction = 'up' | 'down' | 'flat'

export function directionOf(delta: number): Direction {
  if (delta > 0) return 'up'
  if (delta < 0) return 'down'
  return 'flat'
}

/** Signed change in cents: 125 → "+1.25", −40 → "−0.40", 0 → "0.00". */
export function formatSignedPrice(deltaCents: number): string {
  if (!Number.isFinite(deltaCents)) return '—'
  const sign = deltaCents > 0 ? '+' : deltaCents < 0 ? MINUS : ''
  return `${sign}${usd.format(Math.abs(deltaCents) / 100)}`
}

/** Signed change as a percent with 2 decimals: 0.0125 → "+1.25%". */
export function formatSignedPercent(ratio: number): string {
  if (!Number.isFinite(ratio)) return '—'
  const pct = Math.abs(ratio * 100)
  // Round first so "-0.001%" doesn't print as "−0.00%".
  const rounded = Math.round(pct * 100) / 100
  const sign = rounded === 0 ? '' : ratio > 0 ? '+' : MINUS
  return `${sign}${rounded.toFixed(2)}%`
}

/** "just now", "42s ago", "3m ago", "2h ago", then a short date. */
export function formatRelativeTime(at: number, now: number): string {
  const s = Math.max(0, Math.floor((now - at) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Milliseconds as a clock: 754_000 → "12:34"; 3_725_000 → "1:02:05". */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`
}

/** Wall-clock time of a print: "14:03:27". */
export function formatTimeOfDay(at: number): string {
  return new Date(at).toLocaleTimeString('en-GB', { hour12: false })
}
