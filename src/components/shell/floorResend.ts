/**
 * When to re-publish your `{ ticker }` to the floor's PresenceRoom.
 *
 * The room drops peer state when it hibernates, so someone who joins later
 * never receives an `updateState` sent before. We re-send when a new peer
 * appears (so the newcomer gets it within a round trip) and on a slow
 * heartbeat as a backstop. Never on a plain render.
 */

/** Backstop re-send interval while connected with a ticker set. */
export const FLOOR_RESEND_MS = 15_000

/**
 * The user ids in `peers` that were not in `prev`. A peer who left and came
 * back counts as new, because `prev` is always the last snapshot, not every
 * id ever seen.
 */
export function joinedPeerIds(prev: ReadonlySet<string>, peers: readonly { userId: string }[]): string[] {
  const joined: string[] = []
  for (const p of peers) if (!prev.has(p.userId) && !joined.includes(p.userId)) joined.push(p.userId)
  return joined
}
