import { TICKERS, type Ticker } from '@/shared/contracts'

export interface OnlineTrader {
  userId: string
  name: string
  /** Ticker this trader is watching, from floor presence. */
  ticker: Ticker | null
  /** Connected to the floor right now (PresenceRoom), not just a recent heartbeat. */
  onFloor: boolean
  isSelf: boolean
}

interface MergeInput {
  self: { userId: string; name: string } | null
  /** Whether this viewer's own floor socket is connected right now. */
  selfOnFloor: boolean
  /** PresenceRoom peers (excludes self). */
  peers: { userId: string; userName: string; state: Record<string, unknown> }[]
  /** Roster users with a recent heartbeat (usePresence). */
  heartbeat: { id: string; name: string }[]
}

function asTicker(v: unknown): Ticker | null {
  return typeof v === 'string' && (TICKERS as readonly string[]).includes(v) ? (v as Ticker) : null
}

/**
 * One row per online user: yourself first, then everyone on the floor, then
 * users with only a recent heartbeat. Sorted by name within each group.
 */
export function mergeOnline({ self, selfOnFloor, peers, heartbeat }: MergeInput): OnlineTrader[] {
  const byId = new Map<string, OnlineTrader>()
  for (const p of peers) {
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
  const others = [...byId.values()]
    .filter((t) => t.userId !== self?.userId)
    .sort((a, b) => Number(b.onFloor) - Number(a.onFloor) || a.name.localeCompare(b.name))
  if (!self) return others
  const selfPeer = peers.find((p) => p.userId === self.userId)
  return [
    {
      userId: self.userId,
      name: self.name || 'You',
      ticker: selfOnFloor && selfPeer ? asTicker(selfPeer.state.ticker) : null,
      onFloor: selfOnFloor,
      isSelf: true,
    },
    ...others,
  ]
}
