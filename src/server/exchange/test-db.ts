/**
 * Test-only: an in-memory SQLite (node:sqlite) behind the same `SqlLike` /
 * `Txn` surface the Durable Object provides, so ExchangeCore runs on real SQL.
 * Imported only by *.test.ts files; never bundled into the worker.
 */
import type { SqlLike, SqlValue, Txn } from './sql.js'

interface Statement {
  all(...bindings: SqlValue[]): unknown[]
}
interface Database {
  prepare(sql: string): Statement
}

// A computed specifier keeps node-only types out of the worker's type program.
const sqliteModule = 'node:sqlite'
const { DatabaseSync } = (await import(/* @vite-ignore */ sqliteModule)) as {
  DatabaseSync: new (path: string) => Database
}

export function memoryDb(): { sql: SqlLike; txn: Txn } {
  const db = new DatabaseSync(':memory:')
  const sql: SqlLike = {
    exec(query, ...bindings) {
      const out = db.prepare(query).all(...bindings).map((r) => ({ ...(r as object) }))
      return { toArray: () => out }
    },
  }
  let depth = 0
  const txn: Txn = (fn) => {
    const name = `sp${depth++}`
    db.prepare(`SAVEPOINT ${name}`).all()
    try {
      const out = fn()
      db.prepare(`RELEASE ${name}`).all()
      return out
    } catch (err) {
      db.prepare(`ROLLBACK TO ${name}`).all()
      db.prepare(`RELEASE ${name}`).all()
      throw err
    } finally {
      depth--
    }
  }
  return { sql, txn }
}
