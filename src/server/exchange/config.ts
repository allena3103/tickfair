/**
 * Runtime knobs. Only the two round durations can be overridden, and only by
 * env vars that are meant for local test and evaluation runs.
 */
import { ROUND_BREAK_MS, ROUND_LIVE_MS, TICKERS, type Ticker } from '../../shared/contracts.js'
import { MM_BOT_ID, NOISE_BOT_ID } from '../../engine/market/index.js'

export interface Durations {
  liveMs: number
  breakMs: number
}

export interface DurationEnv {
  EXCHANGE_ROUND_LIVE_MS?: string
  EXCHANGE_ROUND_BREAK_MS?: string
}

/** A positive whole number of ms, or the contract default. Anything else is ignored. */
function msOverride(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw)
  return Number.isSafeInteger(n) && n >= 1_000 ? n : fallback
}

export function roundDurations(env: DurationEnv): Durations {
  return {
    liveMs: msOverride(env.EXCHANGE_ROUND_LIVE_MS, ROUND_LIVE_MS),
    breakMs: msOverride(env.EXCHANGE_ROUND_BREAK_MS, ROUND_BREAK_MS),
  }
}

/** No open sockets and no orders for this long → the alarm stops re-arming. */
export const IDLE_PAUSE_MS = 5 * 60_000

/** Mirror budget per alarm tick (SPIKE S3 / LESSONS 7). */
export const MIRROR_WRITES_PER_TICK = 40
/** A mirror row that fails this many times in a row is logged and dropped. */
export const MIRROR_MAX_ATTEMPTS = 5
/** `tickers.lastCents` is mirrored every N batches; live prices go over the WS. */
export const TICKER_MIRROR_EVERY = 5

/** Prints kept for `ex.snapshot.recentPrints`. */
export const SNAPSHOT_PRINTS = 60
/** Depth levels per side. */
export const DEPTH_LEVELS = 10

export const BOT_IDS = [MM_BOT_ID, NOISE_BOT_ID] as const
export const isBotId = (userId: string): boolean => userId.startsWith('bot:')

const perTicker = (qty: number): Record<Ticker, number> =>
  Object.fromEntries(TICKERS.map((t) => [t, qty])) as Record<Ticker, number>

/**
 * Bot accounts are seeded at every round start so long-only bots can sell
 * (LESSONS 11). The maker quotes up to 200 shares a side per ticker per batch;
 * these stocks last a full round even if players lean on one side.
 */
export const BOT_SEED: Record<string, { cashCents: number; shares: Record<Ticker, number> }> = {
  [MM_BOT_ID]: { cashCents: 50_000_000_00, shares: perTicker(20_000) },
  [NOISE_BOT_ID]: { cashCents: 5_000_000_00, shares: perTicker(5_000) },
}
