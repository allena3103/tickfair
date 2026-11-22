/**
 * Typed reads and writes over the exchange tables. No rules live here: the
 * money rules are engine-core's, the round rules are core.ts's.
 */
import { TICKERS, type OrderStatus, type OrderType, type Phase, type Side, type Ticker } from '../../shared/contracts.js'
import type { Account, BookOrder } from '../../engine/core/index.js'
import type { BotState, Fundamental } from '../../engine/market/index.js'
import { one, rows, type SqlLike } from './sql.js'

// ---------------------------------------------------------------------------
// meta
// ---------------------------------------------------------------------------

export interface Meta {
  roundId: string
  phase: Phase
  /** Round end while live, next round start during the break. */
  phaseEndsAt: number
  roundStartsAt: number
  roundEndsAt: number
  /** The batch currently collecting orders. It clears at `nextBatchAt`. */
  batchId: number
  nextBatchAt: number
  lastActivityAt: number
  /** Server-only seed for this round's PRNG (fundamental walk, bots). Never sent out. */
  roundSecret: string
  /** 1 after an invariant failure halted the round; cleared by the next round start. */
  halted: number
}

const NUMERIC_META: (keyof Meta)[] = [
  'phaseEndsAt', 'roundStartsAt', 'roundEndsAt', 'batchId', 'nextBatchAt', 'lastActivityAt', 'halted',
]

/** null until the first round has started. */
export function readMeta(sql: SqlLike): Meta | null {
  const kv = rows<{ k: string; v: string }>(sql, `SELECT k, v FROM meta`)
  if (kv.length === 0) return null
  const out: Record<string, string | number> = {}
  for (const { k, v } of kv) out[k] = (NUMERIC_META as string[]).includes(k) ? Number(v) : v
  if (typeof out.roundId !== 'string' || out.roundId === '') return null
  return out as unknown as Meta
}

export function writeMeta(sql: SqlLike, patch: Partial<Meta>): void {
  for (const [k, v] of Object.entries(patch)) {
    sql.exec(`INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`, k, String(v))
  }
}

// ---------------------------------------------------------------------------
// accounts + holdings
// ---------------------------------------------------------------------------

export interface AccountRow {
  userId: string
  displayName: string
  cashCents: number
  reservedCents: number
}

export function loadAccount(sql: SqlLike, userId: string): Account | null {
  const a = one<AccountRow>(sql, `SELECT * FROM accounts WHERE userId = ?`, userId)
  if (!a) return null
  const holdings = {} as Account['holdings']
  for (const t of TICKERS) holdings[t] = { qty: 0, reservedQty: 0 }
  for (const h of rows<{ ticker: Ticker; qty: number; reservedQty: number }>(
    sql,
    `SELECT ticker, qty, reservedQty FROM holdings WHERE userId = ?`,
    userId,
  )) {
    holdings[h.ticker] = { qty: h.qty, reservedQty: h.reservedQty }
  }
  return { cashCents: a.cashCents, reservedCents: a.reservedCents, holdings }
}

export function displayNameOf(sql: SqlLike, userId: string): string {
  return one<{ displayName: string }>(sql, `SELECT displayName FROM accounts WHERE userId = ?`, userId)?.displayName ?? ''
}

export function insertAccount(sql: SqlLike, userId: string, roundId: string, displayName: string, acct: Account): void {
  sql.exec(
    `INSERT INTO accounts (userId, roundId, displayName, cashCents, reservedCents) VALUES (?, ?, ?, ?, ?)`,
    userId, roundId, displayName, acct.cashCents, acct.reservedCents,
  )
  saveHoldings(sql, userId, acct)
}

export function saveAccount(sql: SqlLike, userId: string, acct: Account): void {
  sql.exec(`UPDATE accounts SET cashCents = ?, reservedCents = ? WHERE userId = ?`, acct.cashCents, acct.reservedCents, userId)
  saveHoldings(sql, userId, acct)
}

function saveHoldings(sql: SqlLike, userId: string, acct: Account): void {
  for (const t of TICKERS) {
    const h = acct.holdings[t]
    sql.exec(
      `INSERT INTO holdings (userId, ticker, qty, reservedQty) VALUES (?, ?, ?, ?)
       ON CONFLICT(userId, ticker) DO UPDATE SET qty = excluded.qty, reservedQty = excluded.reservedQty`,
      userId, t, h.qty, h.reservedQty,
    )
  }
}

export function setDisplayName(sql: SqlLike, userId: string, displayName: string): void {
  sql.exec(`UPDATE accounts SET displayName = ? WHERE userId = ?`, displayName, userId)
}

export function allAccountIds(sql: SqlLike): string[] {
  return rows<{ userId: string }>(sql, `SELECT userId FROM accounts ORDER BY userId`).map((r) => r.userId)
}

/** Total cash (free + reserved) and total shares per ticker across every account. */
export function totals(sql: SqlLike): { cash: number; shares: Record<Ticker, number> } {
  const cash = Number(one<{ c: number | null }>(sql, `SELECT SUM(cashCents + reservedCents) AS c FROM accounts`)?.c ?? 0)
  const shares = {} as Record<Ticker, number>
  for (const t of TICKERS) shares[t] = 0
  for (const r of rows<{ ticker: Ticker; q: number }>(sql, `SELECT ticker, SUM(qty) AS q FROM holdings GROUP BY ticker`)) {
    shares[r.ticker] = Number(r.q)
  }
  return { cash, shares }
}

// ---------------------------------------------------------------------------
// book
// ---------------------------------------------------------------------------

export interface OrderRow {
  orderId: string
  userId: string
  ticker: Ticker
  side: Side
  type: OrderType
  qty: number
  remaining: number
  limitCents: number
  filledQty: number
  /** Sum of qty × price over this order's fills, for avgFillCents. */
  fillValueCents: number
  /** The batch the order arrived in. */
  batchId: number
  status: OrderStatus
}

export const LIVE = `status IN ('open', 'partial')`

export function toBookOrder(o: OrderRow): BookOrder {
  return {
    orderId: o.orderId,
    traderId: o.userId,
    ticker: o.ticker,
    side: o.side,
    limitCents: o.limitCents,
    remaining: o.remaining,
    batchId: o.batchId,
  }
}

export function getOrder(sql: SqlLike, orderId: string): OrderRow | undefined {
  return one<OrderRow>(sql, `SELECT * FROM book WHERE orderId = ?`, orderId)
}

export function liveOrdersForTicker(sql: SqlLike, ticker: Ticker): OrderRow[] {
  return rows<OrderRow>(sql, `SELECT * FROM book WHERE ticker = ? AND ${LIVE} ORDER BY orderId`, ticker)
}

export function liveOrdersForUser(sql: SqlLike, userId: string): OrderRow[] {
  return rows<OrderRow>(sql, `SELECT * FROM book WHERE userId = ? AND ${LIVE} ORDER BY orderId`, userId)
}

export function allLiveOrders(sql: SqlLike): OrderRow[] {
  return rows<OrderRow>(sql, `SELECT * FROM book WHERE ${LIVE} ORDER BY orderId`)
}

export function ordersInBatch(sql: SqlLike, userId: string, batchId: number): number {
  return Number(one<{ n: number }>(sql, `SELECT COUNT(*) AS n FROM book WHERE userId = ? AND batchId = ?`, userId, batchId)?.n ?? 0)
}

export function insertOrder(sql: SqlLike, o: OrderRow): void {
  sql.exec(
    `INSERT INTO book (orderId, userId, ticker, side, type, qty, remaining, limitCents, filledQty, fillValueCents, batchId, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    o.orderId, o.userId, o.ticker, o.side, o.type, o.qty, o.remaining, o.limitCents, o.filledQty, o.fillValueCents,
    o.batchId, o.status,
  )
}

export function saveOrder(sql: SqlLike, o: OrderRow): void {
  sql.exec(
    `UPDATE book SET remaining = ?, filledQty = ?, fillValueCents = ?, status = ? WHERE orderId = ?`,
    o.remaining, o.filledQty, o.fillValueCents, o.status, o.orderId,
  )
}

/** Bots never look up their old orders, so finished ones are dropped to keep the book small. */
export function dropFinishedBotOrders(sql: SqlLike): void {
  sql.exec(`DELETE FROM book WHERE userId LIKE 'bot:%' AND NOT ${LIVE}`)
}

/** Aggregated live quantity per (ticker, side, price). No identities. */
export function depthLevels(sql: SqlLike): { ticker: Ticker; side: Side; price: number; qty: number }[] {
  return rows(
    sql,
    `SELECT ticker, side, limitCents AS price, SUM(remaining) AS qty FROM book WHERE ${LIVE}
     GROUP BY ticker, side, limitCents`,
  )
}

// ---------------------------------------------------------------------------
// batches (prints)
// ---------------------------------------------------------------------------

export interface PrintRow {
  batchId: number
  ticker: Ticker
  roundId: string
  seed: string
  clearCents: number
  volume: number
  at: number
}

export function insertPrint(sql: SqlLike, p: PrintRow): void {
  sql.exec(
    `INSERT OR REPLACE INTO batches (batchId, ticker, roundId, seed, clearCents, volume, at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    p.batchId, p.ticker, p.roundId, p.seed, p.clearCents, p.volume, p.at,
  )
}

export function recentPrints(sql: SqlLike, limit: number): PrintRow[] {
  return rows<PrintRow>(sql, `SELECT * FROM batches ORDER BY batchId DESC, ticker LIMIT ?`, limit).reverse()
}

// ---------------------------------------------------------------------------
// fundamentals + bots
// ---------------------------------------------------------------------------

export interface MarketRow extends Fundamental {
  lastCents: number
  openCents: number
}

export function loadMarket(sql: SqlLike): Record<Ticker, MarketRow> {
  const out = {} as Record<Ticker, MarketRow>
  for (const r of rows<MarketRow & { ticker: Ticker }>(sql, `SELECT * FROM fundamentals`)) {
    out[r.ticker] = {
      valueCents: r.valueCents,
      targetCents: r.targetCents,
      rampLeft: r.rampLeft,
      lastCents: r.lastCents,
      openCents: r.openCents,
    }
  }
  for (const t of TICKERS) if (!out[t]) throw new Error(`fundamentals row missing for ${t}`)
  return out
}

export function saveMarket(sql: SqlLike, market: Record<Ticker, MarketRow>): void {
  for (const t of TICKERS) {
    const m = market[t]
    sql.exec(
      `INSERT INTO fundamentals (ticker, valueCents, targetCents, rampLeft, lastCents, openCents) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(ticker) DO UPDATE SET valueCents = excluded.valueCents, targetCents = excluded.targetCents,
         rampLeft = excluded.rampLeft, lastCents = excluded.lastCents, openCents = excluded.openCents`,
      t, m.valueCents, m.targetCents, m.rampLeft, m.lastCents, m.openCents,
    )
  }
}

export function loadBotState(sql: SqlLike, botId: string): BotState {
  const r = one<{ state: string }>(sql, `SELECT state FROM bots WHERE botId = ?`, botId)
  if (!r) throw new Error(`bot state missing for ${botId}`)
  return JSON.parse(r.state) as BotState
}

export function saveBotState(sql: SqlLike, botId: string, state: BotState): void {
  sql.exec(
    `INSERT INTO bots (botId, state) VALUES (?, ?) ON CONFLICT(botId) DO UPDATE SET state = excluded.state`,
    botId, JSON.stringify(state),
  )
}

/** Wipe everything that belongs to one round. Meta, shocks history, and the mirror outbox stay. */
export function clearRoundTables(sql: SqlLike): void {
  for (const t of ['accounts', 'holdings', 'book', 'batches', 'fundamentals', 'bots']) sql.exec(`DELETE FROM ${t}`)
}
