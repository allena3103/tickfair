/**
 * The engine decides each news event's ticker, direction, and size (PLAN D6).
 * The LLM only writes text for the draw it is given.
 */
import { TICKERS, type NewsDraw } from '../../shared/contracts'
import type { Rng } from './rng'

export const MINOR_BPS = { lo: 100, hi: 200 } as const
export const MAJOR_BPS = { lo: 400, hi: 800 } as const
export const RAMP_BATCHES = { lo: 10, hi: 20 } as const
/** Share of events that are major. */
export const MAJOR_CHANCE = 0.25

/** `deltaBps` is signed (direction × size), ready to pass to /exchange/shock. */
export function drawNewsEvent(rng: Rng): NewsDraw {
  const ticker = TICKERS[rng.int(0, TICKERS.length - 1)]
  const direction: 1 | -1 = rng.next() < 0.5 ? 1 : -1
  const size: NewsDraw['size'] = rng.next() < MAJOR_CHANCE ? 'major' : 'minor'
  const range = size === 'major' ? MAJOR_BPS : MINOR_BPS
  const magnitude = rng.int(range.lo, range.hi)
  const rampBatches = rng.int(RAMP_BATCHES.lo, RAMP_BATCHES.hi)
  return { ticker, direction, size, deltaBps: direction * magnitude, rampBatches }
}
