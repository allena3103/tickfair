/**
 * The ExchangeRoom's private SQLite schema (PLAN §4) and the tiny SQL surface
 * the exchange code needs. `SqlLike` matches the Durable Object `SqlStorage`
 * and is easy to back with `node:sqlite` in unit tests.
 */

export type SqlValue = string | number | null

export interface SqlLike {
  exec(query: string, ...bindings: SqlValue[]): { toArray(): unknown[] }
}

/** Runs `fn` atomically: every write commits together or none do (the DO's `transactionSync`). */
export type Txn = <T>(fn: () => T) => T

export function rows<T>(sql: SqlLike, query: string, ...bindings: SqlValue[]): T[] {
  return sql.exec(query, ...bindings).toArray() as T[]
}

export function one<T>(sql: SqlLike, query: string, ...bindings: SqlValue[]): T | undefined {
  return rows<T>(sql, query, ...bindings)[0]
}

const TABLES = [
  // Round state as key/value strings (see store.ts `Meta`).
  `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
  // cashCents is FREE cash; reservedCents is held for open buys (LESSONS 14).
  `CREATE TABLE IF NOT EXISTS accounts (
     userId TEXT PRIMARY KEY, roundId TEXT NOT NULL, displayName TEXT NOT NULL,
     cashCents INTEGER NOT NULL, reservedCents INTEGER NOT NULL)`,
  // qty is ALL shares owned; reservedQty is the part held for open sells.
  `CREATE TABLE IF NOT EXISTS holdings (
     userId TEXT NOT NULL, ticker TEXT NOT NULL, qty INTEGER NOT NULL, reservedQty INTEGER NOT NULL,
     PRIMARY KEY (userId, ticker))`,
  // Every order of the round. Live = status open|partial. limitCents is the
  // limit the reservation was made at (the band edge for market orders).
  `CREATE TABLE IF NOT EXISTS book (
     orderId TEXT PRIMARY KEY, userId TEXT NOT NULL, ticker TEXT NOT NULL, side TEXT NOT NULL,
     type TEXT NOT NULL, qty INTEGER NOT NULL, remaining INTEGER NOT NULL, limitCents INTEGER NOT NULL,
     filledQty INTEGER NOT NULL, fillValueCents INTEGER NOT NULL, batchId INTEGER NOT NULL,
     status TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS book_by_ticker ON book (ticker, status)`,
  `CREATE INDEX IF NOT EXISTS book_by_user ON book (userId, status)`,
  `CREATE INDEX IF NOT EXISTS book_by_batch ON book (userId, batchId)`,
  // Prints of the current round (volume > 0 only).
  `CREATE TABLE IF NOT EXISTS batches (
     batchId INTEGER NOT NULL, ticker TEXT NOT NULL, roundId TEXT NOT NULL, seed TEXT NOT NULL,
     clearCents INTEGER NOT NULL, volume INTEGER NOT NULL, at INTEGER NOT NULL,
     PRIMARY KEY (batchId, ticker))`,
  // Hidden value plus the public last/open price per ticker.
  `CREATE TABLE IF NOT EXISTS fundamentals (
     ticker TEXT PRIMARY KEY, valueCents INTEGER NOT NULL, targetCents INTEGER NOT NULL,
     rampLeft INTEGER NOT NULL, lastCents INTEGER NOT NULL, openCents INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS bots (botId TEXT PRIMARY KEY, state TEXT NOT NULL)`,
  // Applied shocks, so a retried /exchange/shock with the same newsId is a no-op.
  `CREATE TABLE IF NOT EXISTS shocks (
     newsId TEXT PRIMARY KEY, roundId TEXT NOT NULL, ticker TEXT NOT NULL, at INTEGER NOT NULL)`,
  // Outbox for the RecordRoom mirror, coalesced by (collection, recordId).
  // `ver` bumps on every rewrite so a flush only deletes the version it sent.
  `CREATE TABLE IF NOT EXISTS mirror (
     collection TEXT NOT NULL, recordId TEXT NOT NULL, actor TEXT NOT NULL, data TEXT NOT NULL,
     ver INTEGER NOT NULL, seq INTEGER NOT NULL, prio INTEGER NOT NULL, attempts INTEGER NOT NULL,
     PRIMARY KEY (collection, recordId))`,
  `CREATE INDEX IF NOT EXISTS mirror_by_prio ON mirror (prio, seq)`,
]

export function createTables(sql: SqlLike): void {
  for (const stmt of TABLES) sql.exec(stmt)
}
