import { describe, expect, it } from 'vitest'
import { TICKERS, type Ticker } from '../../shared/contracts'
import {
  INITIAL_PRICES,
  MAJOR_BPS,
  MIN_PRICE_CENTS,
  MINOR_BPS,
  RAMP_BATCHES,
  applyShock,
  bandFor,
  createRng,
  drawNewsEvent,
  initialBotState,
  initialFundamentals,
  marketMakerQuotes,
  noiseTraderOrders,
  stepFundamental,
  type BotIntent,
  type Fundamental,
  type Rng,
} from './index'

/** Rng that always returns the same value; used for worst-case walks. */
const constRng = (v: number): Rng => ({ next: () => v, int: (lo) => lo })

const lastAtInitial = (): Record<Ticker, number> => ({ ...INITIAL_PRICES })

describe('createRng', () => {
  it('gives an identical sequence for the same seed', () => {
    const take = (r: Rng) => Array.from({ length: 1000 }, () => [r.next(), r.int(-5, 5)])
    expect(take(createRng('round-42'))).toEqual(take(createRng('round-42')))
  })

  it('gives different sequences for different seeds', () => {
    const a = createRng('seed-a')
    const b = createRng('seed-b')
    const sa = Array.from({ length: 10 }, () => a.next())
    const sb = Array.from({ length: 10 }, () => b.next())
    expect(sa).not.toEqual(sb)
  })

  it('next() is in [0,1) and int() covers both inclusive ends', () => {
    const r = createRng('range')
    const seen = new Set<number>()
    const bad: number[] = []
    for (let i = 0; i < 10_000; i++) {
      const x = r.next()
      if (!(x >= 0 && x < 1)) bad.push(x)
      const n = r.int(3, 7)
      if (!Number.isInteger(n) || n < 3 || n > 7) bad.push(n)
      seen.add(n)
    }
    expect(bad).toEqual([])
    expect([...seen].sort()).toEqual([3, 4, 5, 6, 7])
  })

  it('int() rejects a bad range', () => {
    expect(() => createRng('x').int(5, 1)).toThrow(RangeError)
    expect(() => createRng('x').int(0.5, 2)).toThrow(RangeError)
  })
})

describe('fundamental', () => {
  it('reaches the +600 bps target in exactly 15 steps with no noise', () => {
    const rng = createRng('shock')
    let f = applyShock({ valueCents: 12_000, targetCents: 12_000, rampLeft: 0 }, 600, 15)
    expect(f.targetCents).toBe(12_720)
    for (let i = 1; i <= 15; i++) {
      f = stepFundamental(f, rng, 0)
      if (i < 15) expect(Math.abs(f.valueCents - 12_720)).toBeGreaterThan(1)
    }
    expect(Math.abs(f.valueCents - 12_720)).toBeLessThanOrEqual(1)
    expect(f.rampLeft).toBe(0)
    // And it stays there.
    f = stepFundamental(f, rng, 0)
    expect(f.valueCents).toBe(12_720)
  })

  it('ramp moves monotonically toward a negative target', () => {
    const rng = createRng('neg')
    let f = applyShock({ valueCents: 4_500, targetCents: 4_500, rampLeft: 0 }, -800, 10)
    let prev = f.valueCents
    for (let i = 0; i < 10; i++) {
      f = stepFundamental(f, rng, 0)
      expect(f.valueCents).toBeLessThan(prev)
      prev = f.valueCents
    }
    expect(f.valueCents).toBe(4_140)
  })

  it('noise does not change the remaining ramp gap, so the ramp still lands', () => {
    const rng = createRng('noisy-ramp')
    let f = applyShock({ valueCents: 8_000, targetCents: 8_000, rampLeft: 0 }, 500, 12)
    for (let i = 0; i < 12; i++) f = stepFundamental(f, rng)
    expect(f.rampLeft).toBe(0)
    expect(f.valueCents).toBe(f.targetCents)
    // Noise over 12 steps is at most 12 × 4 bps of ~8400.
    expect(Math.abs(f.valueCents - 8_400)).toBeLessThanOrEqual(45)
  })

  it('overlapping shocks stack on the current target', () => {
    let f = applyShock({ valueCents: 10_000, targetCents: 10_000, rampLeft: 0 }, 500, 10)
    f = applyShock(f, 500, 10)
    expect(f.targetCents).toBe(11_025)
    expect(f.rampLeft).toBe(10)
  })

  it('rejects a non-integer or zero ramp', () => {
    const f: Fundamental = { valueCents: 100_00, targetCents: 100_00, rampLeft: 0 }
    expect(() => applyShock(f, 100, 0)).toThrow(RangeError)
    expect(() => applyShock(f, 100, 2.5)).toThrow(RangeError)
    expect(() => applyShock(f, Number.NaN, 5)).toThrow(RangeError)
  })

  it('the walk alone cannot drift a price under $1 in a round (worst case: every step down)', () => {
    const down = constRng(0)
    for (const t of TICKERS) {
      let f = initialFundamentals()[t]
      for (let i = 0; i < 900; i++) f = stepFundamental(f, down)
      expect(f.valueCents).toBeGreaterThan(MIN_PRICE_CENTS)
      expect(f.valueCents).toBeGreaterThan(INITIAL_PRICES[t] * 0.6)
    }
  })

  it('stays at or above $1 even under a worst-case walk plus repeated major down shocks', () => {
    const down = constRng(0)
    let f = initialFundamentals().CURA
    let lowest = Infinity
    for (let i = 0; i < 900; i++) {
      if (i % 60 === 0) f = applyShock(f, -MAJOR_BPS.hi, RAMP_BATCHES.lo)
      f = stepFundamental(f, down)
      lowest = Math.min(lowest, f.valueCents, f.targetCents)
    }
    expect(lowest).toBeGreaterThanOrEqual(MIN_PRICE_CENTS)
    // A shock far below the floor is clamped to the floor.
    expect(applyShock({ valueCents: 150, targetCents: 150, rampLeft: 0 }, -9_000, 10).targetCents).toBe(
      MIN_PRICE_CENTS,
    )
  })

  it('values are always integer cents', () => {
    const rng = createRng('ints')
    let f = initialFundamentals().VOLT
    const bad: Fundamental[] = []
    for (let i = 0; i < 500; i++) {
      if (i % 50 === 0) f = applyShock(f, 333, 13)
      f = stepFundamental(f, rng)
      if (!Number.isInteger(f.valueCents) || !Number.isInteger(f.targetCents)) bad.push(f)
    }
    expect(bad).toEqual([])
  })
})

describe('drawNewsEvent', () => {
  it('stays within bounds over 10,000 draws and covers every outcome', () => {
    const rng = createRng('news')
    const tickers = new Set<Ticker>()
    let majors = 0
    let ups = 0
    const bad: unknown[] = []
    for (let i = 0; i < 10_000; i++) {
      const d = drawNewsEvent(rng)
      const mag = Math.abs(d.deltaBps)
      const range = d.size === 'major' ? MAJOR_BPS : MINOR_BPS
      const ok =
        TICKERS.includes(d.ticker) &&
        (d.direction === 1 || d.direction === -1) &&
        Math.sign(d.deltaBps) === d.direction &&
        Number.isInteger(d.deltaBps) &&
        mag >= range.lo &&
        mag <= range.hi &&
        Number.isInteger(d.rampBatches) &&
        d.rampBatches >= RAMP_BATCHES.lo &&
        d.rampBatches <= RAMP_BATCHES.hi
      if (!ok) bad.push(d)
      tickers.add(d.ticker)
      if (d.size === 'major') majors++
      if (d.direction === 1) ups++
    }
    expect(bad).toEqual([])
    expect(tickers.size).toBe(3)
    expect(majors).toBeGreaterThan(2_000)
    expect(majors).toBeLessThan(3_000)
    expect(ups).toBeGreaterThan(4_500)
    expect(ups).toBeLessThan(5_500)
  })

  it('is deterministic for a seed', () => {
    const a = createRng('n1')
    const b = createRng('n1')
    for (let i = 0; i < 100; i++) expect(drawNewsEvent(a)).toEqual(drawNewsEvent(b))
  })
})

const quote = (intents: BotIntent[], t: Ticker, side: 'buy' | 'sell') =>
  intents.find((i) => i.ticker === t && i.side === side)

describe('marketMakerQuotes', () => {
  it('bid is always below ask, quotes stay in band, sizes and spread in range', () => {
    const rng = createRng('mm-bounds')
    const funds = initialFundamentals()
    let state = initialBotState()
    const last = lastAtInitial()
    // Violations are collected and asserted once: per-iteration expect() calls
    // dominated this test's runtime and made it flaky under parallel load.
    const bad: string[] = []
    let twoSided = 0
    for (let b = 0; b < 2_000; b++) {
      for (const t of TICKERS) {
        if (b % 97 === 0) funds[t] = applyShock(funds[t], rng.int(-800, 800), rng.int(10, 20))
        funds[t] = stepFundamental(funds[t], rng)
        state.inventory[t] = rng.int(-3_000, 3_000)
      }
      const out = marketMakerQuotes(state, funds, last, rng)
      state = out.state
      for (const t of TICKERS) {
        const band = bandFor(last[t])
        const bid = quote(out.intents, t, 'buy')
        const ask = quote(out.intents, t, 'sell')
        if (!bid && !ask) bad.push(`b${b} ${t}: no quote`)
        for (const q of [bid, ask]) {
          if (!q) continue
          const ok =
            q.botId === 'bot:mm' &&
            Number.isInteger(q.limitCents) &&
            q.limitCents >= band.lo &&
            q.limitCents <= band.hi &&
            q.qty >= 50 &&
            q.qty <= 200
          if (!ok) bad.push(`b${b} ${t}: ${JSON.stringify(q)} band ${band.lo}-${band.hi}`)
        }
        if (bid && ask) {
          twoSided++
          if (bid.limitCents >= ask.limitCents) bad.push(`b${b} ${t}: bid ${bid.limitCents} >= ask ${ask.limitCents}`)
          if (bid.limitCents > band.lo && ask.limitCents < band.hi) {
            const mid = (bid.limitCents + ask.limitCents) / 2
            const spread = ask.limitCents - bid.limitCents
            // 20–60 bps of mid; floor/ceil to whole cents can widen it by < 2 cents.
            if (spread < (mid * 20) / 10_000 - 0.5 || spread >= (mid * 60) / 10_000 + 2) {
              bad.push(`b${b} ${t}: spread ${spread} at mid ${mid}`)
            }
          }
          // Next batch's band follows wherever the maker is quoting.
          last[t] = Math.round((bid.limitCents + ask.limitCents) / 2)
        }
      }
    }
    expect(bad).toEqual([])
    // Guard against the property passing vacuously.
    expect(twoSided).toBeGreaterThan(5_000)
  })

  it('long inventory shades both quotes lower; short shades them higher', () => {
    const funds = initialFundamentals()
    const run = (inv: number) => {
      const s = initialBotState()
      for (const t of TICKERS) s.inventory[t] = inv
      return marketMakerQuotes(s, funds, lastAtInitial(), createRng('skew')).intents
    }
    const flat = run(0)
    const long = run(1_000)
    const short = run(-1_000)
    for (const t of TICKERS) {
      expect(quote(long, t, 'buy')!.limitCents).toBeLessThan(quote(flat, t, 'buy')!.limitCents)
      expect(quote(long, t, 'sell')!.limitCents).toBeLessThan(quote(flat, t, 'sell')!.limitCents)
      expect(quote(short, t, 'buy')!.limitCents).toBeGreaterThan(quote(flat, t, 'buy')!.limitCents)
      expect(quote(short, t, 'sell')!.limitCents).toBeGreaterThan(quote(flat, t, 'sell')!.limitCents)
    }
  })

  it('estimate lags a shocked fundamental, then converges within ~20 batches', () => {
    const rng = createRng('converge')
    const funds = initialFundamentals()
    funds.ORBT = applyShock(funds.ORBT, 600, 15)
    let state = initialBotState()
    const gaps: number[] = []
    for (let b = 1; b <= 25; b++) {
      for (const t of TICKERS) funds[t] = stepFundamental(funds[t], rng, 0)
      state = marketMakerQuotes(state, funds, lastAtInitial(), rng).state
      gaps.push(funds.ORBT.valueCents - state.estimateCents.ORBT)
    }
    // The skill window: early on the maker is clearly behind the fundamental.
    expect(gaps[4]).toBeGreaterThan(100)
    // Within ~20 batches it has caught up to within 0.5% of 12,720.
    expect(Math.abs(gaps[19])).toBeLessThan(64)
    // And it fully converges shortly after.
    expect(Math.abs(gaps[24])).toBeLessThanOrEqual(15)
    // Untouched tickers stay put.
    expect(state.estimateCents.CURA).toBe(INITIAL_PRICES.CURA)
  })

  it('does not mutate its input state', () => {
    const state = initialBotState()
    const before = JSON.parse(JSON.stringify(state))
    const funds = initialFundamentals()
    funds.VOLT = { ...funds.VOLT, valueCents: 9_000 }
    marketMakerQuotes(state, funds, lastAtInitial(), createRng('pure'))
    expect(state).toEqual(before)
  })

  it('quotes one side at the band edge when the estimate is outside the band', () => {
    const funds = initialFundamentals()
    const state = initialBotState()
    state.estimateCents.ORBT = 20_000
    funds.ORBT = { valueCents: 20_000, targetCents: 20_000, rampLeft: 0 }
    const { intents } = marketMakerQuotes(state, funds, lastAtInitial(), createRng('edge'))
    const orbt = intents.filter((i) => i.ticker === 'ORBT')
    expect(orbt).toHaveLength(1)
    expect(orbt[0].side).toBe('buy')
    expect(orbt[0].limitCents).toBe(bandFor(12_000).hi)
  })

  it('is deterministic for a seed', () => {
    const go = () => {
      const rng = createRng('mm-det')
      const funds = initialFundamentals()
      let state = initialBotState()
      const all: BotIntent[] = []
      for (let b = 0; b < 50; b++) {
        for (const t of TICKERS) funds[t] = stepFundamental(funds[t], rng)
        const out = marketMakerQuotes(state, funds, lastAtInitial(), rng)
        state = out.state
        all.push(...out.intents)
      }
      return all
    }
    expect(go()).toEqual(go())
  })
})

describe('noiseTraderOrders', () => {
  it('orders always fall within the price band of last, at the band edge', () => {
    const rng = createRng('noise')
    let fired = 0
    const bad: string[] = []
    const batches = 5_000
    for (let b = 0; b < batches; b++) {
      const last = {} as Record<Ticker, number>
      for (const t of TICKERS) last[t] = rng.int(100, 50_000)
      const orders = noiseTraderOrders(last, rng)
      fired += orders.length
      for (const o of orders) {
        const band = bandFor(last[o.ticker])
        const ok =
          o.botId === 'bot:noise' &&
          o.limitCents >= band.lo &&
          o.limitCents <= band.hi &&
          o.limitCents === (o.side === 'buy' ? band.hi : band.lo) &&
          // Band edges really are within ±10% of last.
          o.limitCents >= last[o.ticker] * 0.9 &&
          o.limitCents <= last[o.ticker] * 1.1 &&
          Number.isInteger(o.qty) &&
          o.qty >= 1 &&
          o.qty <= 50
        if (!ok) bad.push(`${JSON.stringify(o)} last ${last[o.ticker]}`)
      }
    }
    expect(bad).toEqual([])
    const rate = fired / (batches * TICKERS.length)
    expect(rate).toBeGreaterThan(0.27)
    expect(rate).toBeLessThan(0.33)
  })

  it('skips a ticker with no valid last price', () => {
    const last = { ORBT: 0, CURA: Number.NaN, VOLT: -5 } as Record<Ticker, number>
    const fire = constRng(0) // always fires
    expect(noiseTraderOrders(last, fire)).toEqual([])
  })

  it('is deterministic for a seed', () => {
    const a = createRng('nd')
    const b = createRng('nd')
    for (let i = 0; i < 200; i++) {
      expect(noiseTraderOrders(lastAtInitial(), a)).toEqual(noiseTraderOrders(lastAtInitial(), b))
    }
  })
})
