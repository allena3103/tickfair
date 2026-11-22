import { describe, expect, it } from 'vitest'
import { FLOOR_RESEND_MS, joinedPeerIds } from './floorResend'

const peers = (...ids: string[]) => ids.map((userId) => ({ userId }))

describe('floor ticker re-send trigger', () => {
  it('fires when a new peer appears', () => {
    expect(joinedPeerIds(new Set(['a', 'b']), peers('a', 'b', 'c'))).toEqual(['c'])
    expect(joinedPeerIds(new Set(), peers('a', 'b'))).toEqual(['a', 'b'])
  })

  it('does not fire for the same peers (a re-render or a peer state update)', () => {
    expect(joinedPeerIds(new Set(['a', 'b']), peers('b', 'a'))).toEqual([])
    expect(joinedPeerIds(new Set(['a', 'b']), [])).toEqual([])
  })

  it('does not fire when a peer leaves, but does when they come back', () => {
    expect(joinedPeerIds(new Set(['a', 'b']), peers('a'))).toEqual([])
    // The caller keeps only the last snapshot, so a rejoin is new again.
    expect(joinedPeerIds(new Set(['a']), peers('a', 'b'))).toEqual(['b'])
  })

  it('a peer with two connections counts once', () => {
    expect(joinedPeerIds(new Set(), peers('a', 'a'))).toEqual(['a'])
  })

  it('heartbeat is modest: 15-20 s', () => {
    expect(FLOOR_RESEND_MS).toBeGreaterThanOrEqual(15_000)
    expect(FLOOR_RESEND_MS).toBeLessThanOrEqual(20_000)
  })
})
