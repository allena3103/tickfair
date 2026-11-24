/**
 * Frozen cross-worker contracts (see orchestrations/files/BRIEF.md "Frozen
 * contracts"). Types and constants only — no logic. Changing anything here
 * needs the director's approval because other modules code against it.
 *
 * Units: money is integer cents, quantity is integer shares, time is epoch ms,
 * ids are server-generated strings.
 */

// ---------------------------------------------------------------------------
// Units and tickers
// ---------------------------------------------------------------------------

/** Orbital Compute (tech), Curaline Bio (biotech), Voltgrid Energy (energy). */
export const TICKERS = ['ORBT', 'CURA', 'VOLT'] as const
export type Ticker = (typeof TICKERS)[number]
export type Side = 'buy' | 'sell'
export type OrderType = 'limit' | 'market'

export const START_CASH_CENTS = 10_000_000
export const BATCH_MS = 1_000
export const ROUND_LIVE_MS = 15 * 60_000
export const ROUND_BREAK_MS = 2 * 60_000
/** ±10% of last clear. */
export const PRICE_BAND_BPS = 1_000
export const MAX_ORDERS_PER_BATCH = 10
export const MAX_OPEN_ORDERS = 20
/**
 * Simulated players: server-side bots shown on the live leaderboard with a BOT
 * tag. Like every `bot:` id they never place orders through player requests
 * and never appear in round standings or as a round winner.
 */
export const SIM_PLAYER_PREFIX = 'bot:sim:'

// ---------------------------------------------------------------------------
// Server actions (client → worker)
// ---------------------------------------------------------------------------

/** POST /api/actions/placeOrder */
export interface PlaceOrderParams {
  ticker: Ticker
  side: Side
  type: OrderType
  qty: number
  limitCents?: number
}
export interface PlaceOrderData {
  orderId: string
  batchId: number
}

/** POST /api/actions/cancelOrder */
export interface CancelOrderParams {
  orderId: string
}

/** POST /api/actions/breakingNews (owner only) */
export interface BreakingNewsParams {
  ticker?: Ticker
}

/**
 * One news event drawn by the engine (market-sim's `drawNewsEvent`).
 * The engine picks direction and size; the LLM only writes text for it.
 * minor = 100–200 bps, major = 400–800 bps, ramp 10–20 batches.
 */
export interface NewsDraw {
  ticker: Ticker
  direction: 1 | -1
  size: 'minor' | 'major'
  deltaBps: number
  rampBatches: number
}

/** Actions return ActionResult: `{ success: false, error: RejectCode }` on rejection. */
export type RejectCode =
  | 'round_closed'
  | 'invalid_ticker'
  | 'invalid_side'
  | 'invalid_type'
  | 'invalid_qty'
  | 'invalid_price'
  | 'outside_band'
  | 'insufficient_cash'
  | 'insufficient_shares'
  | 'self_cross'
  | 'rate_limited'
  | 'too_many_open'
  | 'not_found'
  | 'not_owner'
  | 'already_final'
  | 'forbidden'

// ---------------------------------------------------------------------------
// Worker → ExchangeRoom (DO stub fetch only; never publicly routed)
// Singleton room name: `exchange:${DEEPSPACE_APP_ID}`; binding EXCHANGE_ROOMS.
// ---------------------------------------------------------------------------

/** POST /exchange/order */
export interface ExchangeOrderRequest {
  userId: string
  displayName: string
  params: PlaceOrderParams
}
export type ExchangeOrderResponse =
  | { ok: true; data: PlaceOrderData }
  | { ok: false; code: RejectCode }

/** POST /exchange/cancel */
export interface ExchangeCancelRequest {
  userId: string
  orderId: string
}
export type ExchangeCancelResponse = { ok: true } | { ok: false; code: RejectCode }

/** POST /exchange/shock */
export interface ExchangeShockRequest {
  newsId: string
  ticker: Ticker
  deltaBps: number
  rampBatches: number
}
export type ExchangeShockResponse = { ok: true } | { ok: false; code: 'round_closed' | 'bad_request' }

// ---------------------------------------------------------------------------
// ExchangeRoom → client WebSocket (`/ws/exchange/:roomId`; anonymous = spectator)
// Clients send nothing on this socket (orders go through server actions).
// ---------------------------------------------------------------------------

/** Top 10 levels, aggregated, no identities. */
export type Depth = {
  bids: [priceCents: number, qty: number][]
  asks: [priceCents: number, qty: number][]
}

export interface Print {
  ticker: Ticker
  roundId: string
  batchId: number
  clearCents: number
  volume: number
  seed: string
}

export type Phase = 'live' | 'break'

export type ExchangeServerMsg =
  | {
      type: 'ex.snapshot'
      roundId: string
      phase: Phase
      phaseEndsAt: number
      batchId: number
      nextBatchAt: number
      last: Record<Ticker, number>
      depth: Record<Ticker, Depth>
      recentPrints: Print[]
    }
  | {
      type: 'ex.batch'
      roundId: string
      batchId: number
      nextBatchAt: number
      last: Record<Ticker, number>
      depth: Record<Ticker, Depth>
      prints: Print[]
    }
  | { type: 'ex.phase'; roundId: string; phase: Phase; phaseEndsAt: number }

// ---------------------------------------------------------------------------
// RecordRoom collections (scope `app:${APP_ID}`; all client writes denied).
// Record data shapes; fields live under `record.data`.
// The impact size of a news event is never stored or sent to clients.
// ---------------------------------------------------------------------------

export type OrderStatus = 'open' | 'partial' | 'filled' | 'cancelled'
export type RoundStatus = 'live' | 'done'

/** `tickers`, recordId = ticker */
export interface TickerRecord {
  symbol: Ticker
  name: string
  sector: string
  lastCents: number
  openCents: number
}

/** `orders`, recordId = orderId */
export interface OrderRecord {
  userId: string
  ticker: Ticker
  side: Side
  type: OrderType
  qty: number
  limitCents: number
  filledQty: number
  avgFillCents: number
  status: OrderStatus
  batchId: number
  roundId: string
}

/** `fills`, recordId = `${orderId}:${batchId}` */
export interface FillRecord {
  userId: string
  orderId: string
  ticker: Ticker
  side: Side
  qty: number
  priceCents: number
  batchId: number
  roundId: string
}

/** `tape`, recordId = `${roundId}:${ticker}:${batchId}` */
export interface TapeRecord {
  ticker: Ticker
  roundId: string
  batchId: number
  clearCents: number
  volume: number
  seed: string
  at: number
}

/** `portfolios`, recordId = `${roundId}:${userId}` */
export interface PortfolioRecord {
  userId: string
  displayName: string
  roundId: string
  cashCents: number
  holdings: Record<Ticker, number>
}

/** `news`, recordId = newsId */
export interface NewsRecord {
  roundId: string
  ticker: Ticker
  headline: string
  body: string
  publishedAt: number
}

export interface Standing {
  userId: string
  displayName: string
  equityCents: number
}

/** `rounds`, recordId = roundId */
export interface RoundRecord {
  startsAt: number
  endsAt: number
  status: RoundStatus
  standings: Standing[]
  winnerId: string
}
