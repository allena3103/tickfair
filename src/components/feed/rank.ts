import { START_CASH_CENTS, TICKERS, type PortfolioRecord, type Ticker } from '@/shared/contracts'
import { isBotId, isSimPlayerId } from '../shell/tickers'

export interface LeaderRow {
  rank: number
  userId: string
  displayName: string
  cashCents: number
  equityCents: number
  /** Equity minus the starting cash. */
  pnlCents: number
  /** A sim player: shown with a BOT tag, never a round winner. */
  isBot: boolean
}

/**
 * `holdings` is a json column. The records layer normally hands back an
 * object, but accept a JSON string too, and treat anything else as no shares.
 */
function readHoldings(raw: unknown): Partial<Record<Ticker, number>> {
  let value = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return {}
    }
  }
  return value && typeof value === 'object' ? (value as Partial<Record<Ticker, number>>) : {}
}

/** Equity = cash + Σ qty × last. A ticker with no last price counts as 0. */
export function equityOf(p: Pick<PortfolioRecord, 'cashCents' | 'holdings'>, last: Partial<Record<Ticker, number>>): number {
  const holdings = readHoldings(p.holdings)
  let equity = Number(p.cashCents) || 0
  for (const t of TICKERS) {
    const qty = Number(holdings[t]) || 0
    const px = Number(last[t]) || 0
    equity += qty * px
  }
  return equity
}

/**
 * Rank traders by equity, highest first. Sim players (`bot:sim:` ids) are
 * ranked alongside humans and flagged `isBot`; every other bot is left out.
 * Equal equity shares a rank (1, 1, 3); ties list by name, then id, so the
 * order is stable across renders.
 */
export function rankPortfolios(portfolios: PortfolioRecord[], last: Partial<Record<Ticker, number>>): LeaderRow[] {
  const rows = portfolios
    .filter((p) => p && typeof p.userId === 'string' && (!isBotId(p.userId) || isSimPlayerId(p.userId)))
    .map((p) => {
      const equityCents = equityOf(p, last)
      return {
        rank: 0,
        userId: p.userId,
        displayName: p.displayName || 'Trader',
        cashCents: Number(p.cashCents) || 0,
        equityCents,
        pnlCents: equityCents - START_CASH_CENTS,
        isBot: isSimPlayerId(p.userId),
      }
    })
    .sort(
      (a, b) =>
        b.equityCents - a.equityCents ||
        a.displayName.localeCompare(b.displayName) ||
        a.userId.localeCompare(b.userId),
    )
  rows.forEach((row, i) => {
    row.rank = i > 0 && row.equityCents === rows[i - 1].equityCents ? rows[i - 1].rank : i + 1
  })
  return rows
}
