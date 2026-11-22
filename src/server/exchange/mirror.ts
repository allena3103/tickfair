/**
 * One-way projection of exchange state into RecordRoom (SPIKE S3).
 *
 * Writes are queued in the `mirror` table inside the same transaction as the
 * state change, keyed by (collection, recordId). A later change to the same
 * record replaces the queued data, so each record is written at most once per
 * flush. The alarm drains up to MIRROR_WRITES_PER_TICK rows per tick with one
 * parallel fan-out and carries the rest to the next tick.
 *
 * A failed row is never dropped: losing a fill, an order status, a portfolio,
 * or a round's `done` record would leave RecordRoom wrong for good. It stays
 * queued and is retried with per-row exponential backoff (1 s doubling to a
 * 64 s ceiling), with a warning per failure, until RecordRoom accepts it.
 *
 * Every write is `records.create` with a server-generated recordId, which
 * upserts (merges) when the id exists. Retrying a row can therefore never
 * duplicate a fill, an order, or a print.
 *
 * `actor` is the X-User-Id the write is sent as. For `orders` and `fills` it
 * must be the trader: those collections stamp the userBound `userId` from the
 * caller and reject a different value for the immutable field (LESSONS 3–4).
 * Every other collection is written as the app owner (actor '').
 */
import type {
  FillRecord,
  OrderRecord,
  PortfolioRecord,
  RoundRecord,
  TapeRecord,
  TickerRecord,
} from '../../shared/contracts.js'
import { BATCH_MS } from '../../shared/contracts.js'
import { MIRROR_BACKOFF_MAX_EXP, MIRROR_WRITES_PER_TICK } from './config.js'
import { rows, type SqlLike } from './sql.js'

/** Lower drains first: round status, then per-user records, then market history. */
const PRIO = { rounds: 0, orders: 1, fills: 1, portfolios: 1, tape: 2, tickers: 3 } as const

export type MirrorItem =
  | { collection: 'rounds'; recordId: string; data: RoundRecord }
  | { collection: 'orders'; recordId: string; actor: string; data: OrderRecord }
  | { collection: 'fills'; recordId: string; actor: string; data: FillRecord }
  | { collection: 'portfolios'; recordId: string; data: PortfolioRecord }
  | { collection: 'tape'; recordId: string; data: TapeRecord }
  | { collection: 'tickers'; recordId: string; data: TickerRecord }

export function enqueue(sql: SqlLike, item: MirrorItem): void {
  const actor = 'actor' in item ? item.actor : ''
  sql.exec(
    `INSERT INTO mirror (collection, recordId, actor, data, ver, seq, prio, attempts)
     VALUES (?, ?, ?, ?, 1, (SELECT COALESCE(MAX(seq), 0) + 1 FROM mirror), ?, 0)
     ON CONFLICT(collection, recordId) DO UPDATE SET
       actor = excluded.actor, data = excluded.data, ver = mirror.ver + 1`,
    item.collection, item.recordId, actor, JSON.stringify(item.data), PRIO[item.collection],
  )
}

export function pendingCount(sql: SqlLike): number {
  return Number((rows<{ n: number }>(sql, `SELECT COUNT(*) AS n FROM mirror`)[0]?.n) ?? 0)
}

/** Earliest time any queued row may be sent, or null when the queue is empty. */
export function nextDueAt(sql: SqlLike): number | null {
  const v = rows<{ t: number | null }>(sql, `SELECT MIN(nextAt) AS t FROM mirror`)[0]?.t
  return v === null || v === undefined ? null : Number(v)
}

/** Delay before retry number `attempts + 1` of a row that has failed `attempts` times before. */
export function backoffMs(attempts: number): number {
  return BATCH_MS * 2 ** Math.min(attempts, MIRROR_BACKOFF_MAX_EXP)
}

interface QueuedRow {
  collection: string
  recordId: string
  actor: string
  data: string
  ver: number
  attempts: number
}

export interface MirrorWrite {
  collection: string
  recordId: string
  /** '' means the app owner. */
  actor: string
  data: Record<string, unknown>
}

/** Resolves on success; throws (or rejects) with a short reason on failure. */
export type MirrorWriter = (w: MirrorWrite) => Promise<void>

export interface FlushResult {
  sent: number
  failed: number
  left: number
}

/**
 * Send up to `cap` queued rows that are due at `now`. A row is removed only if
 * it still has the version that was sent; if it changed during the await, the
 * newer data stays queued for the next flush. A failed row stays queued and
 * waits out its backoff; a rewrite of it keeps the backoff, so an outage is
 * not hammered.
 */
export async function flushMirror(
  sql: SqlLike,
  write: MirrorWriter,
  warn: (line: string) => void,
  now: number,
  cap: number = MIRROR_WRITES_PER_TICK,
): Promise<FlushResult> {
  const batch = rows<QueuedRow>(
    sql,
    `SELECT collection, recordId, actor, data, ver, attempts FROM mirror WHERE nextAt <= ? ORDER BY prio, seq LIMIT ?`,
    now,
    cap,
  )
  const results = await Promise.allSettled(
    batch.map((r) =>
      write({ collection: r.collection, recordId: r.recordId, actor: r.actor, data: JSON.parse(r.data) as Record<string, unknown> }),
    ),
  )

  let sent = 0
  let failed = 0
  results.forEach((res, i) => {
    const r = batch[i]
    if (res.status === 'fulfilled') {
      sent++
      sql.exec(`DELETE FROM mirror WHERE collection = ? AND recordId = ? AND ver = ?`, r.collection, r.recordId, r.ver)
      return
    }
    failed++
    const reason = res.reason instanceof Error ? res.reason.message : String(res.reason)
    const wait = backoffMs(r.attempts)
    warn(
      `[exchange] mirror write failed (attempt ${r.attempts + 1}) ${r.collection}/${r.recordId}, retry in ${wait / 1000}s: ${reason.slice(0, 200)}`,
    )
    // Any version: the backoff belongs to the record, not to the data that failed.
    sql.exec(
      `UPDATE mirror SET attempts = ?, nextAt = ? WHERE collection = ? AND recordId = ?`,
      r.attempts + 1, now + wait, r.collection, r.recordId,
    )
  })
  return { sent, failed, left: pendingCount(sql) }
}
