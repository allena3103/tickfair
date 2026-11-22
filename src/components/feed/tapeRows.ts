import type { TapeRecord, Ticker } from '@/shared/contracts'

export interface TapeRow extends TapeRecord {
  id: string
  /** Change from the previous print of the same ticker; null for the first print we have. */
  changeCents: number | null
}

/**
 * Newest first, each print compared with the previous print of the same
 * ticker in the same round. Sorted by time, then batch, so equal timestamps
 * stay stable.
 */
export function buildTape(prints: { id: string; data: TapeRecord }[], ticker?: Ticker): TapeRow[] {
  const sorted = prints
    .filter((p) => !ticker || p.data.ticker === ticker)
    .slice()
    .sort((a, b) => b.data.at - a.data.at || b.data.batchId - a.data.batchId || b.id.localeCompare(a.id))
  const rows: TapeRow[] = sorted.map((p) => ({ ...p.data, id: p.id, changeCents: null }))
  // Walk oldest → newest and remember the last price per ticker and round.
  const prev = new Map<string, number>()
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]
    const key = `${r.roundId}:${r.ticker}`
    const before = prev.get(key)
    r.changeCents = before === undefined ? null : r.clearCents - before
    prev.set(key, r.clearCents)
  }
  return rows
}
