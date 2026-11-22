/**
 * PLAN §4 invariants, checked after every batch and at round end.
 * A violation throws InvariantError; the caller rolls the transaction back,
 * logs `[exchange] INVARIANT ...`, and halts the round.
 */
import { TICKERS, type Ticker } from '../../shared/contracts.js'
import { LIVE, loadAccount, totals } from './store.js'
import { rows, type SqlLike } from './sql.js'

export class InvariantError extends Error {}

function fail(detail: string): never {
  throw new InvariantError(detail)
}

/**
 * For each account: no negative balances, reservations match exactly what
 * the account's live orders hold, and qty >= reservedQty >= 0.
 */
export function checkAccounts(sql: SqlLike, userIds: Iterable<string>): void {
  for (const userId of userIds) {
    const acct = loadAccount(sql, userId)
    if (!acct) fail(`account ${userId} missing`)
    if (!Number.isSafeInteger(acct.cashCents) || acct.cashCents < 0) fail(`${userId} cashCents ${acct.cashCents}`)
    if (!Number.isSafeInteger(acct.reservedCents) || acct.reservedCents < 0) {
      fail(`${userId} reservedCents ${acct.reservedCents}`)
    }

    const held = rows<{ side: string; ticker: Ticker; c: number; q: number }>(
      sql,
      `SELECT side, ticker, SUM(remaining * limitCents) AS c, SUM(remaining) AS q FROM book
       WHERE userId = ? AND ${LIVE} GROUP BY side, ticker`,
      userId,
    )
    const buyCents = held.filter((h) => h.side === 'buy').reduce((s, h) => s + Number(h.c), 0)
    if (buyCents !== acct.reservedCents) fail(`${userId} reservedCents ${acct.reservedCents} != open buys ${buyCents}`)

    for (const t of TICKERS) {
      const { qty, reservedQty } = acct.holdings[t]
      if (!(qty >= reservedQty && reservedQty >= 0)) fail(`${userId} ${t} qty ${qty} reservedQty ${reservedQty}`)
      const sellQty = Number(held.find((h) => h.side === 'sell' && h.ticker === t)?.q ?? 0)
      if (sellQty !== reservedQty) fail(`${userId} ${t} reservedQty ${reservedQty} != open sells ${sellQty}`)
    }
  }
}

export type Totals = ReturnType<typeof totals>

/** Trades only move value between accounts: total cash and total shares per ticker are unchanged. */
export function checkConservation(before: Totals, after: Totals): void {
  if (before.cash !== after.cash) fail(`cash total ${before.cash} -> ${after.cash}`)
  for (const t of TICKERS) {
    if (before.shares[t] !== after.shares[t]) fail(`${t} share total ${before.shares[t]} -> ${after.shares[t]}`)
  }
}
