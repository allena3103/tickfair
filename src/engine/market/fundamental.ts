/**
 * Hidden "true value" per ticker. Each batch it takes a small random step;
 * after a news shock it also walks toward a target over `rampLeft` batches.
 * Integer cents throughout.
 */
import type { Ticker } from '../../shared/contracts'
import type { Rng } from './rng'

export interface Fundamental {
  valueCents: number
  targetCents: number
  /** Batches left until valueCents reaches targetCents. 0 = no ramp active. */
  rampLeft: number
}

export const INITIAL_PRICES: Record<Ticker, number> = {
  ORBT: 12_000,
  CURA: 4_500,
  VOLT: 8_000,
}

/** Floor for any fundamental or shock target: $1. */
export const MIN_PRICE_CENTS = 100

/**
 * Max size of one random-walk step, in bps of the current value. Worst case
 * (every step down) over a 900-batch round is ~0.9996^900 ≈ 0.70×, so the walk
 * alone can't take any ticker near $1. MIN_PRICE_CENTS is the hard backstop.
 */
export const WALK_BPS = 4

export function initialFundamentals(): Record<Ticker, Fundamental> {
  const out = {} as Record<Ticker, Fundamental>
  for (const [t, p] of Object.entries(INITIAL_PRICES) as [Ticker, number][]) {
    out[t] = { valueCents: p, targetCents: p, rampLeft: 0 }
  }
  return out
}

const clampPrice = (c: number): number => Math.max(MIN_PRICE_CENTS, Math.round(c))

/**
 * One batch step. The ramp moves value 1/rampLeft of the remaining gap, so it
 * lands exactly on target when rampLeft reaches 0. The noise is added to value
 * and target alike, so it never changes how far the ramp has left to go.
 * `walkBps = 0` gives a noise-free step (used by tests).
 */
export function stepFundamental(f: Fundamental, rng: Rng, walkBps: number = WALK_BPS): Fundamental {
  let value = f.valueCents
  let target = f.targetCents
  let rampLeft = f.rampLeft

  if (rampLeft > 0) {
    value += Math.round((target - value) / rampLeft)
    rampLeft -= 1
  }

  // Always draw, so the rng sequence doesn't depend on walkBps or ramp state.
  const noise = Math.round(((rng.next() * 2 - 1) * value * walkBps) / 10_000)
  value = clampPrice(value + noise)
  target = rampLeft === 0 ? value : clampPrice(target + noise)

  return { valueCents: value, targetCents: target, rampLeft }
}

/**
 * Start a news shock: move the target by `deltaBps` (signed) and restart the
 * ramp. The shock compounds on the current target, so overlapping news on the
 * same ticker stacks instead of the second one cancelling the first.
 */
export function applyShock(f: Fundamental, deltaBps: number, rampBatches: number): Fundamental {
  if (!Number.isFinite(deltaBps)) throw new RangeError('applyShock: deltaBps must be finite')
  if (!Number.isInteger(rampBatches) || rampBatches < 1) {
    throw new RangeError('applyShock: rampBatches must be a positive integer')
  }
  return {
    valueCents: f.valueCents,
    targetCents: clampPrice(f.targetCents * (1 + deltaBps / 10_000)),
    rampLeft: rampBatches,
  }
}
