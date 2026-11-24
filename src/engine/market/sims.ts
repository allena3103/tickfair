/**
 * Simulated players. Four named bots that trade like small retail players so
 * a visitor who is alone on the floor still sees a moving leaderboard.
 *
 * They see only public information: this batch's and the previous batch's
 * last price, and the round-open price. They never read the hidden
 * fundamental or news impact, so they can't front-run news and don't take
 * the skill edge away from players who read the headlines.
 *
 * Each sim acts with some chance per batch, picks one ticker its strategy has
 * a view on, and places one order priced a little through `last` so it
 * usually fills against the maker or depth.
 * Sizes are capped by the sim's own free cash and shares, so its orders are
 * not rejected for funds.
 */
import { SIM_PLAYER_PREFIX, TICKERS, type Side, type Ticker } from '../../shared/contracts'
import { bandFor, type BotIntent } from './bots'
import type { Rng } from './rng'

export type SimStrategy = 'momentum' | 'reversion' | 'dip' | 'casual'

export interface SimPlayer {
  id: string
  name: string
  strategy: SimStrategy
  /** Chance per batch that this sim places an order. */
  actChance: number
}

export const SIM_PLAYERS: readonly SimPlayer[] = [
  { id: `${SIM_PLAYER_PREFIX}max`, name: 'Momentum Max', strategy: 'momentum', actChance: 0.3 },
  { id: `${SIM_PLAYER_PREFIX}rita`, name: 'Reversion Rita', strategy: 'reversion', actChance: 0.3 },
  { id: `${SIM_PLAYER_PREFIX}dan`, name: 'Dip Buyer Dan', strategy: 'dip', actChance: 0.3 },
  { id: `${SIM_PLAYER_PREFIX}cal`, name: 'Casual Cal', strategy: 'casual', actChance: 0.2 },
]

export const SIM_QTY = { lo: 5, hi: 100 } as const
/** How far through `last` a sim prices its order, in bps (past the maker's half-spread, so it usually fills). */
export const SIM_SLIP_BPS = { lo: 10, hi: 40 } as const
/** Reversion Rita only trades a ticker once it is this far from its round open. */
export const SIM_REVERSION_BPS = 15

/** Public prices a sim may look at. */
export interface SimView {
  last: Record<Ticker, number>
  /** Last price before the most recent clear (equal to `last` if nothing printed). */
  prevLast: Record<Ticker, number>
  open: Record<Ticker, number>
}

/** What a sim can spend: free cash and free shares (no live orders at quote time). */
export interface SimWallet {
  cashCents: number
  shares: Record<Ticker, number>
}

const validPrice = (c: number | undefined): c is number => typeof c === 'number' && Number.isFinite(c) && c > 0

/** The side this strategy wants on `t`, or null to sit out. */
function wantedSide(strategy: SimStrategy, t: Ticker, view: SimView, coin: number): Side | null {
  const move = view.last[t] - view.prevLast[t]
  switch (strategy) {
    case 'momentum':
      return move > 0 ? 'buy' : move < 0 ? 'sell' : null
    case 'dip':
      return move < 0 ? 'buy' : move > 0 ? 'sell' : null
    case 'reversion': {
      const devBps = ((view.last[t] - view.open[t]) / view.open[t]) * 10_000
      return devBps >= SIM_REVERSION_BPS ? 'sell' : devBps <= -SIM_REVERSION_BPS ? 'buy' : null
    }
    case 'casual':
      return coin < 0.5 ? 'buy' : 'sell'
  }
}

export function simPlayerOrders(view: SimView, wallets: Record<string, SimWallet | undefined>, rng: Rng): BotIntent[] {
  const intents: BotIntent[] = []
  for (const sim of SIM_PLAYERS) {
    // Draw every value each time so the sequence doesn't depend on outcomes.
    const act = rng.next() < sim.actChance
    // 60 is divisible by 1, 2, and 3, so `% candidates.length` stays uniform.
    const pick = rng.int(0, 59)
    const slipBps = rng.int(SIM_SLIP_BPS.lo, SIM_SLIP_BPS.hi)
    const want = rng.int(SIM_QTY.lo, SIM_QTY.hi)
    const coin = rng.next()

    const wallet = wallets[sim.id]
    if (!act || !wallet) continue
    // Tickers this strategy has a view on right now; sells need shares to sell.
    const candidates: [Ticker, Side][] = []
    for (const t of TICKERS) {
      if (!validPrice(view.last[t]) || !validPrice(view.prevLast[t]) || !validPrice(view.open[t])) continue
      let side = wantedSide(sim.strategy, t, view, coin)
      // Casual Cal can't sell what he doesn't own, so he buys instead.
      if (sim.strategy === 'casual' && side === 'sell' && wallet.shares[t] <= 0) side = 'buy'
      if (side === null || (side === 'sell' && wallet.shares[t] <= 0)) continue
      candidates.push([t, side])
    }
    if (candidates.length === 0) continue
    const [t, side] = candidates[pick % candidates.length]

    const last = view.last[t]
    const band = bandFor(last)
    const limitCents =
      side === 'buy'
        ? Math.min(band.hi, Math.ceil((last * (10_000 + slipBps)) / 10_000))
        : Math.max(band.lo, Math.floor((last * (10_000 - slipBps)) / 10_000))
    const cap = side === 'buy' ? Math.floor(wallet.cashCents / limitCents) : wallet.shares[t]
    const qty = Math.min(want, cap)
    if (qty < 1) continue
    intents.push({ botId: sim.id, ticker: t, side, qty, limitCents })
  }
  return intents
}
