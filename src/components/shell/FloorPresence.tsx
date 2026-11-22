/**
 * One shared connection to the floor's PresenceRoom (`floor:${APP_ID}`).
 *
 * Mounted once in (app)/_layout.tsx so every page shares a single socket.
 * Peers publish `{ ticker }`, the ticker they're looking at. The trading
 * terminal calls `useFloorPresence().setTicker(t)` when the user switches
 * tabs; OnlineTraders and the header count read `peers`.
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

export const FLOOR_SCOPE = `floor:${APP_ID}`

export type FloorStatus = 'signed-out' | 'connecting' | 'connected' | 'reconnecting'

interface RoomState {
  peers: PresencePeerClient[]
  status: FloorStatus
}

export interface FloorPresence extends RoomState {
  /** Publish the ticker this user is watching. Re-sent after a reconnect. */
  setTicker: (ticker: Ticker | null) => void
}

const SIGNED_OUT: RoomState = { peers: [], status: 'signed-out' }

const FloorPresenceContext = createContext<FloorPresence>({ ...SIGNED_OUT, setTicker: () => {} })

export function useFloorPresence(): FloorPresence {
  return useContext(FloorPresenceContext)
}

export function FloorPresenceProvider({ children }: { children: ReactNode }) {
  const { isSignedIn } = useAuthStatus()
  const [room, setRoom] = useState<RoomState>(SIGNED_OUT)
  const myTicker = useRef<Ticker | null>(null)
  const send = useRef<((state: Record<string, unknown>) => void) | null>(null)

  const setTicker = useCallback((ticker: Ticker | null) => {
    myTicker.current = ticker
    send.current?.({ ticker })
  }, [])

  const value = useMemo(
    () => ({ ...(isSignedIn ? room : SIGNED_OUT), setTicker }),
    [isSignedIn, room, setTicker],
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

  useEffect(() => {
    onRoom({ peers, status: connected ? 'connected' : everConnected ? 'reconnecting' : 'connecting' })
  }, [peers, connected, everConnected, onRoom])

  useEffect(() => () => onRoom(SIGNED_OUT), [onRoom])

  return null
}
