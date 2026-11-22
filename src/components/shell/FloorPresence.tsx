/**
 * One shared connection to the floor's PresenceRoom (`floor:${APP_ID}`).
 *
 * Mounted once in (app)/_layout.tsx so every page shares a single socket.
 * Peers publish `{ ticker }`, the ticker they're looking at. The trading
 * terminal calls `useFloorPresence().setTicker(t)` when the user switches
 * tabs; OnlineTraders and the header count read `peers` and `myTicker`
 * (the PresenceRoom never echoes your own state back in `peers`).
 *
 * Signed-out visitors don't join: peer identity comes from the verified JWT,
 * and a spectator has none.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { useAuthStatus, usePresenceRoom, type PresencePeerClient } from 'deepspace'
import { APP_ID } from '@/constants'
import type { Ticker } from '@/shared/contracts'
import { FLOOR_RESEND_MS, joinedPeerIds } from './floorResend'

export const FLOOR_SCOPE = `floor:${APP_ID}`

export type FloorStatus = 'signed-out' | 'connecting' | 'connected' | 'reconnecting'

interface RoomState {
  peers: PresencePeerClient[]
  status: FloorStatus
}

export interface FloorPresence extends RoomState {
  /** The ticker this user last published, or null. */
  myTicker: Ticker | null
  /** Publish the ticker this user is watching. Re-sent after a reconnect. */
  setTicker: (ticker: Ticker | null) => void
}

const SIGNED_OUT: RoomState = { peers: [], status: 'signed-out' }

const FloorPresenceContext = createContext<FloorPresence>({ ...SIGNED_OUT, myTicker: null, setTicker: () => {} })

export function useFloorPresence(): FloorPresence {
  return useContext(FloorPresenceContext)
}

export function FloorPresenceProvider({ children }: { children: ReactNode }) {
  const { isSignedIn } = useAuthStatus()
  const [room, setRoom] = useState<RoomState>(SIGNED_OUT)
  // Ref for the connector's reconnect re-send; state so the UI re-renders.
  const myTicker = useRef<Ticker | null>(null)
  const [myTickerState, setMyTickerState] = useState<Ticker | null>(null)
  const send = useRef<((state: Record<string, unknown>) => void) | null>(null)

  const setTicker = useCallback((ticker: Ticker | null) => {
    myTicker.current = ticker
    setMyTickerState(ticker)
    send.current?.({ ticker })
  }, [])

  const value = useMemo(
    () => ({ ...(isSignedIn ? room : SIGNED_OUT), myTicker: isSignedIn ? myTickerState : null, setTicker }),
    [isSignedIn, room, myTickerState, setTicker],
  )

  // The connector is a sibling, not a wrapper, so signing in or out never
  // remounts the page underneath.
  return (
    <FloorPresenceContext.Provider value={value}>
      {isSignedIn && <FloorConnector onRoom={setRoom} send={send} myTicker={myTicker} />}
      {children}
    </FloorPresenceContext.Provider>
  )
}

function FloorConnector({
  onRoom,
  send,
  myTicker,
}: {
  onRoom: (room: RoomState) => void
  send: RefObject<((state: Record<string, unknown>) => void) | null>
  myTicker: RefObject<Ticker | null>
}) {
  const { peers, connected, updateState } = usePresenceRoom(FLOOR_SCOPE)
  const [everConnected, setEverConnected] = useState(false)
  if (connected && !everConnected) setEverConnected(true)

  useEffect(() => {
    send.current = updateState
    return () => {
      send.current = null
    }
  }, [send, updateState])

  // A reconnect re-joins with empty state, so publish the ticker again.
  useEffect(() => {
    if (connected && myTicker.current) updateState({ ticker: myTicker.current })
  }, [connected, updateState, myTicker])

  // The room forgets peer state when it hibernates, so a late joiner never
  // sees an earlier updateState. Re-send when someone new appears...
  const knownPeers = useRef<ReadonlySet<string>>(new Set())
  useEffect(() => {
    const joined = joinedPeerIds(knownPeers.current, peers)
    knownPeers.current = new Set(peers.map((p) => p.userId))
    if (connected && joined.length > 0 && myTicker.current) updateState({ ticker: myTicker.current })
  }, [peers, connected, updateState, myTicker])

  // ...and on a slow heartbeat as a backstop.
  useEffect(() => {
    if (!connected) return
    const id = setInterval(() => {
      if (myTicker.current) updateState({ ticker: myTicker.current })
    }, FLOOR_RESEND_MS)
    return () => clearInterval(id)
  }, [connected, updateState, myTicker])

  useEffect(() => {
    onRoom({ peers, status: connected ? 'connected' : everConnected ? 'reconnecting' : 'connecting' })
  }, [peers, connected, everConnected, onRoom])

  useEffect(() => () => onRoom(SIGNED_OUT), [onRoom])

  return null
}
