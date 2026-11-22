/**
 * One-way projection of exchange state into RecordRoom (SPIKE S3).
 *
 * Writes are queued in the `mirror` table inside the same transaction as the
 * state change, keyed by (collection, recordId). A later change to the same
 * record replaces the queued data, so each record is written at most once per
 * flush. The alarm drains up to MIRROR_WRITES_PER_TICK rows per tick with one
 * parallel fan-out and carries the rest to the next tick.
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
import { MIRROR_MAX_ATTEMPTS, MIRROR_WRITES_PER_TICK } from './config.js'
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
       actor = excluded.actor, data = excluded.data, ver = mirror.ver + 1, attempts = 0`,
    item.collection, item.recordId, actor, JSON.stringify(item.data), PRIO[item.collection],
  )
}

export function pendingCount(sql: SqlLike): number {
  return Number((rows<{ n: number }>(sql, `SELECT COUNT(*) AS n FROM mirror`)[0]?.n) ?? 0)
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
  dropped: number
  left: number
}

/**
 * Send up to `cap` queued rows. A row is removed only if it still has the
 * version that was sent; if it changed during the await, the newer data stays
 * queued for the next flush.
 */
export async function flushMirror(
  sql: SqlLike,
  write: MirrorWriter,
  log: (line: string) => void,
  cap: number = MIRROR_WRITES_PER_TICK,
): Promise<FlushResult> {
  const batch = rows<QueuedRow>(
    sql,
    `SELECT collection, recordId, actor, data, ver, attempts FROM mirror ORDER BY prio, seq LIMIT ?`,
    cap,
  )
  const results = await Promise.allSettled(
    batch.map((r) =>
      write({ collection: r.collection, recordId: r.recordId, actor: r.actor, data: JSON.parse(r.data) as Record<string, unknown> }),
    ),
  )

  let sent = 0
  let failed = 0
  let dropped = 0
  results.forEach((res, i) => {
    const r = batch[i]
    if (res.status === 'fulfilled') {
      sent++
      sql.exec(`DELETE FROM mirror WHERE collection = ? AND recordId = ? AND ver = ?`, r.collection, r.recordId, r.ver)
      return
    }
    failed++
    const reason = res.reason instanceof Error ? res.reason.message : String(res.reason)
    if (r.attempts + 1 >= MIRROR_MAX_ATTEMPTS) {
      dropped++
      log(`[exchange] mirror dropped ${r.collection}/${r.recordId} after ${MIRROR_MAX_ATTEMPTS} attempts: ${reason.slice(0, 200)}`)
      sql.exec(`DELETE FROM mirror WHERE collection = ? AND recordId = ? AND ver = ?`, r.collection, r.recordId, r.ver)
    } else {
      sql.exec(
        `UPDATE mirror SET attempts = attempts + 1 WHERE collection = ? AND recordId = ? AND ver = ?`,
        r.collection, r.recordId, r.ver,
      )
    }
  })
  return { sent, failed, dropped, left: pendingCount(sql) }
}
