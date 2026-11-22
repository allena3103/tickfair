/**
 * Bots. They only produce order intents. The runtime submits them through the
 * same reserve and matching path as players (bot ids `bot:mm`, `bot:noise`).
 *
 * Why the market maker lags (the skill window): its price estimate closes only
 * ~20–30% of the gap to the hidden fundamental each batch, and the fundamental
 * itself ramps toward a news target over 10–20 batches. So for several seconds
 * after a headline the maker keeps quoting near the old price. A player who
 * reads the news and trades quickly buys from (or sells to) those stale quotes
 * before they catch up. Batching removes any speed edge inside one second, so
 * the edge comes from reading news well across batches, not from latency.
 */
import { PRICE_BAND_BPS, TICKERS, type Side, type Ticker } from '../../shared/contracts'
import { INITIAL_PRICES, type Fundamental } from './fundamental'
import type { Rng } from './rng'

export const MM_BOT_ID = 'bot:mm'
export const NOISE_BOT_ID = 'bot:noise'

/** Fraction of the estimate→fundamental gap the maker closes each batch. */
export const MM_ALPHA = { lo: 0.2, hi: 0.3 } as const
export const MM_SPREAD_BPS = { lo: 20, hi: 60 } as const
export const MM_SIZE = { lo: 50, hi: 200 } as const
/** Quote shift per 100 shares of inventory, in bps, and its cap. */
export const MM_SKEW_BPS_PER_100 = 10
export const MM_MAX_SKEW_BPS = 200

export const NOISE_CHANCE = 0.3
export const NOISE_QTY = { lo: 1, hi: 50 } as const

export interface BotIntent {
  botId: string
  ticker: Ticker
  side: Side
  qty: number
  limitCents: number
}

export interface BotState {
  /** The maker's lagged view of each fundamental. */
  estimateCents: Record<Ticker, number>
  /**
   * Signed shares relative to the maker's neutral position (positive = long).
   * The runtime updates this from the maker's fills; this module never does.
   */
  inventory: Record<Ticker, number>
}

export function initialBotState(): BotState {
  const inventory = {} as Record<Ticker, number>
  for (const t of TICKERS) inventory[t] = 0
  return { estimateCents: { ...INITIAL_PRICES }, inventory }
}

/**
 * Inclusive price band around `last`, rounded inward so an order at either
 * edge is always inside ±PRICE_BAND_BPS.
 */
export function bandFor(lastCents: number): { lo: number; hi: number } {
  return {
    lo: Math.ceil((lastCents * (10_000 - PRICE_BAND_BPS)) / 10_000),
    hi: Math.floor((lastCents * (10_000 + PRICE_BAND_BPS)) / 10_000),
  }
}

const validPrice = (c: number | undefined): c is number =>
  typeof c === 'number' && Number.isFinite(c) && c > 0

/**
 * Move the estimate toward the fundamental, then quote both sides around it.
 * The runtime cancels the maker's previous quotes before adding these.
 * Quotes are clamped into the band of `last`. If clamping would make them
 * touch or cross, only the side facing the estimate is quoted, at the edge.
 */
export function marketMakerQuotes(
  state: BotState,
  fundamentals: Record<Ticker, Fundamental>,
  last: Record<Ticker, number>,
  rng: Rng,
): { state: BotState; intents: BotIntent[] } {
  const estimateCents = { ...state.estimateCents }
  const inventory = { ...state.inventory }
  const intents: BotIntent[] = []

  for (const t of TICKERS) {
    // Same draws every batch, in ticker order, so replays stay deterministic.
    const alpha = MM_ALPHA.lo + rng.next() * (MM_ALPHA.hi - MM_ALPHA.lo)
    const spreadBps = rng.int(MM_SPREAD_BPS.lo, MM_SPREAD_BPS.hi)
    const bidQty = rng.int(MM_SIZE.lo, MM_SIZE.hi)
    const askQty = rng.int(MM_SIZE.lo, MM_SIZE.hi)

    const prev = estimateCents[t]
    const gap = fundamentals[t].valueCents - prev
    // Move at least 1 cent so the estimate can't stall just short of fair.
    const step = gap === 0 ? 0 : Math.sign(gap) * Math.max(1, Math.round(Math.abs(gap) * alpha))
    const est = prev + step
    estimateCents[t] = est

    const lastCents = last[t]
    if (!validPrice(lastCents) || !validPrice(est)) continue

    const skewBps = Math.max(
      -MM_MAX_SKEW_BPS,
      Math.min(MM_MAX_SKEW_BPS, ((inventory[t] ?? 0) / 100) * MM_SKEW_BPS_PER_100),
    )
    const mid = est * (1 - skewBps / 10_000)
    const half = spreadBps / 2 / 10_000
    let bid = Math.floor(mid * (1 - half))
    let ask = Math.ceil(mid * (1 + half))
    if (ask <= bid) ask = bid + 1

    const band = bandFor(lastCents)
    bid = Math.min(Math.max(bid, band.lo), band.hi)
    ask = Math.min(Math.max(ask, band.lo), band.hi)

    if (bid < ask) {
      intents.push({ botId: MM_BOT_ID, ticker: t, side: 'buy', qty: bidQty, limitCents: bid })
      intents.push({ botId: MM_BOT_ID, ticker: t, side: 'sell', qty: askQty, limitCents: ask })
    } else if (mid >= lastCents) {
      intents.push({ botId: MM_BOT_ID, ticker: t, side: 'buy', qty: bidQty, limitCents: band.hi })
    } else {
      intents.push({ botId: MM_BOT_ID, ticker: t, side: 'sell', qty: askQty, limitCents: band.lo })
    }
  }

  return { state: { estimateCents, inventory }, intents }
}

/**
 * About NOISE_CHANCE per ticker per batch: a small order on a random side,
 * priced at the band edge so it is marketable against any resting quote.
 */
export function noiseTraderOrders(last: Record<Ticker, number>, rng: Rng): BotIntent[] {
  const intents: BotIntent[] = []
  for (const t of TICKERS) {
    // Draw every value each time so the sequence doesn't depend on outcomes.
    const fire = rng.next() < NOISE_CHANCE
    const side: Side = rng.next() < 0.5 ? 'buy' : 'sell'
    const qty = rng.int(NOISE_QTY.lo, NOISE_QTY.hi)
    const lastCents = last[t]
    if (!fire || !validPrice(lastCents)) continue
    const band = bandFor(lastCents)
    intents.push({
      botId: NOISE_BOT_ID,
      ticker: t,
      side,
      qty,
      limitCents: side === 'buy' ? band.hi : band.lo,
    })
  }
  return intents
}
