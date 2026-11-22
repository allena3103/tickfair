import { TICKERS, type Ticker } from '@/shared/contracts'

export interface OnlineTrader {
  userId: string
  name: string
  /** Ticker this trader is watching, from floor presence. */
  ticker: Ticker | null
  /**
   * Connected to the floor right now (PresenceRoom). Only these count as
   * online. The rest had a usePresence heartbeat in the last ~5 minutes and
   * are listed as "recently active".
   */
  onFloor: boolean
  isSelf: boolean
}

interface MergeInput {
  self: { userId: string; name: string } | null
  /** Whether this viewer's own floor socket is connected right now. */
  selfOnFloor: boolean
  /** The ticker this viewer published (PresenceRoom peers exclude self). */
  selfTicker: Ticker | null
  /** PresenceRoom peers (excludes self). */
  peers: { userId: string; userName: string; state: Record<string, unknown> }[]
  /** Roster users with a recent heartbeat (usePresence). */
  heartbeat: { id: string; name: string }[]
}

function asTicker(v: unknown): Ticker | null {
  return typeof v === 'string' && (TICKERS as readonly string[]).includes(v) ? (v as Ticker) : null
}

/**
 * One row per known user: yourself first, then everyone on the floor, then
 * users with only a recent heartbeat. Sorted by name within each group.
 */
export function mergeOnline({ self, selfOnFloor, selfTicker, peers, heartbeat }: MergeInput): OnlineTrader[] {
  const byId = new Map<string, OnlineTrader>()
  for (const p of peers) {
    if (p.userId === self?.userId) continue
    byId.set(p.userId, {
      userId: p.userId,
      name: p.userName || 'Trader',
      ticker: asTicker(p.state.ticker),
      onFloor: true,
      isSelf: false,
    })
  }
  for (const u of heartbeat) {
    if (byId.has(u.id) || u.id === self?.userId) continue
    byId.set(u.id, { userId: u.id, name: u.name || 'Trader', ticker: null, onFloor: false, isSelf: false })
  }
  const others = [...byId.values()].sort(
    (a, b) => Number(b.onFloor) - Number(a.onFloor) || a.name.localeCompare(b.name),
  )
  if (!self) return others
  return [
    {
      userId: self.userId,
      name: self.name || 'You',
      ticker: selfOnFloor ? selfTicker : null,
      onFloor: selfOnFloor,
      isSelf: true,
    },
    ...others,
  ]
}

/** The online count: traders connected to the floor right now (incl. you). */
export function countOnFloor(traders: OnlineTrader[]): number {
  return traders.filter((t) => t.onFloor).length
}
