/**
 * Live market data from the ExchangeRoom socket (`/ws/exchange/exchange:${APP_ID}`).
 *
 * Connects the same way the SDK hooks do: a short-lived JWT from
 * `getAuthToken()` in the `token` query param (the worker verifies it and
 * strips client identity). No token = anonymous spectator. Clients send
 * nothing on this socket; orders go through server actions.
 *
 * Every fresh `ex.snapshot` (first connect or reconnect) replaces state
 * wholesale, so anything missed while disconnected is never patched in.
 */

import { useEffect, useReducer } from 'react'
import { getAuthToken, useAuthStatus } from 'deepspace'
import { APP_ID } from '@/constants'
import {
  TICKERS,
  type Depth,
  type ExchangeServerMsg,
  type Phase,
  type Print,
  type Ticker,
} from '@/shared/contracts'

export const EXCHANGE_ROOM = `exchange:${APP_ID}`

/** Prints kept in memory for the chart and the "latest" checks. */
export const MAX_PRINTS = 600

export interface ExchangeState {
  connected: boolean
  /** True once any snapshot has arrived (connected or not since). */
  synced: boolean
  roundId: string
  phase: Phase | null
  phaseEndsAt: number
  /** The batch now taking orders (LESSONS 24). */
  batchId: number
  nextBatchAt: number
  last: Partial<Record<Ticker, number>>
  depth: Partial<Record<Ticker, Depth>>
  /** Oldest first, deduped by round/ticker/batch. */
  prints: Print[]
}

export const INITIAL_STREAM: ExchangeState = {
  connected: false,
  synced: false,
  roundId: '',
  phase: null,
  phaseEndsAt: 0,
  batchId: 0,
  nextBatchAt: 0,
  last: {},
  depth: {},
  prints: [],
}

export type StreamAction = { type: 'open' } | { type: 'close' } | { type: 'msg'; msg: ExchangeServerMsg }

const printKey = (p: Print) => `${p.roundId}:${p.ticker}:${p.batchId}`

function appendPrints(prev: Print[], next: Print[]): Print[] {
  if (next.length === 0) return prev
  const seen = new Set(prev.map(printKey))
  const fresh = next.filter((p) => !seen.has(printKey(p)))
  if (fresh.length === 0) return prev
  const all = prev.concat(fresh)
  return all.length > MAX_PRINTS ? all.slice(all.length - MAX_PRINTS) : all
}

function cleanLast(raw: unknown): Partial<Record<Ticker, number>> {
  const out: Partial<Record<Ticker, number>> = {}
  if (raw && typeof raw === 'object') {
    for (const t of TICKERS) {
      const n = (raw as Record<string, unknown>)[t]
      if (typeof n === 'number' && Number.isFinite(n) && n > 0) out[t] = n
    }
  }
  return out
}

export function streamReducer(s: ExchangeState, a: StreamAction): ExchangeState {
  switch (a.type) {
    case 'open':
      // Not "connected" until the snapshot lands; until then state may be stale.
      return s
    case 'close':
      return s.connected ? { ...s, connected: false } : s
    case 'msg': {
      const m = a.msg
      if (m.type === 'ex.snapshot') {
        return {
          connected: true,
          synced: true,
          roundId: m.roundId,
          phase: m.phase,
          phaseEndsAt: m.phaseEndsAt,
          batchId: m.batchId,
          nextBatchAt: m.nextBatchAt,
          last: cleanLast(m.last),
          depth: m.depth ?? {},
          prints: appendPrints([], Array.isArray(m.recentPrints) ? [...m.recentPrints].sort((x, y) => x.batchId - y.batchId) : []),
        }
      }
      if (!s.synced) return s // Ignore deltas until a snapshot sets the baseline.
      if (m.type === 'ex.batch') {
        return {
          ...s,
          roundId: m.roundId,
          batchId: m.batchId,
          nextBatchAt: m.nextBatchAt,
          last: { ...s.last, ...cleanLast(m.last) },
          depth: m.depth ?? s.depth,
          prints: appendPrints(s.prints, Array.isArray(m.prints) ? m.prints : []),
        }
      }
      if (m.type === 'ex.phase') {
        // A new round starts with an empty book; old depth would mislead.
        const newRound = m.roundId !== s.roundId
        return {
          ...s,
          roundId: m.roundId,
          phase: m.phase,
          phaseEndsAt: m.phaseEndsAt,
          depth: newRound || m.phase === 'break' ? {} : s.depth,
        }
      }
      return s
    }
  }
}

export function isServerMsg(v: unknown): v is ExchangeServerMsg {
  const t = (v as { type?: unknown } | null)?.type
  return t === 'ex.snapshot' || t === 'ex.batch' || t === 'ex.phase'
}

/** Reconnect delay: 0.5 s, 1 s, 2 s, ... capped at 10 s, with jitter. */
export function backoffMs(attempt: number, rand = Math.random()): number {
  const base = Math.min(10_000, 500 * 2 ** Math.min(attempt, 5))
  return Math.round(base * (0.75 + rand * 0.5))
}

export function useExchangeStream(): ExchangeState {
  const { isLoaded, userId } = useAuthStatus()
  const [state, dispatch] = useReducer(streamReducer, INITIAL_STREAM)

  useEffect(() => {
    if (!isLoaded) return
    let alive = true
    let ws: WebSocket | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0

    const schedule = () => {
      if (!alive || timer) return
      timer = setTimeout(() => {
        timer = null
        void connect()
      }, backoffMs(attempt++))
    }

    const connect = async () => {
      if (!alive) return
      let token: string | null = null
      try {
        token = userId ? await getAuthToken() : null
      } catch {
        token = null
      }
      if (!alive) return
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const url = new URL(`/ws/exchange/${encodeURIComponent(EXCHANGE_ROOM)}`, `${protocol}//${window.location.host}`)
      if (token) url.searchParams.set('token', token)
      const socket = new WebSocket(url.toString())
      ws = socket
      socket.onopen = () => {
        if (ws !== socket) return socket.close()
        dispatch({ type: 'open' })
      }
      socket.onmessage = (ev) => {
        if (ws !== socket) return
        let msg: unknown
        try {
          msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '')
        } catch {
          return
        }
        if (!isServerMsg(msg)) return
        if (msg.type === 'ex.snapshot') attempt = 0
        dispatch({ type: 'msg', msg })
      }
      socket.onclose = () => {
        if (ws !== socket) return
        ws = null
        dispatch({ type: 'close' })
        schedule()
      }
      socket.onerror = () => socket.close()
    }

    const onOnline = () => {
      if (!ws && !timer) void connect()
    }
    window.addEventListener('online', onOnline)
    void connect()

    return () => {
      alive = false
      window.removeEventListener('online', onOnline)
      if (timer) clearTimeout(timer)
      const s = ws
      ws = null
      s?.close()
      dispatch({ type: 'close' })
    }
  }, [isLoaded, userId])

  return state
}
