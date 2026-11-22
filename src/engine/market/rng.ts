/**
 * Seeded PRNG: xmur3 string hash feeding sfc32. Same seed → same sequence,
 * on every platform, so rounds can be replayed and tests are deterministic.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number
  /** Uniform integer in [lo, hi], both ends inclusive. */
  int(lo: number, hi: number): number
}

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return h >>> 0
  }
}

export function createRng(seed: string): Rng {
  const hash = xmur3(seed)
  let a = hash()
  let b = hash()
  let c = hash()
  let d = hash()

  const next = (): number => {
    a >>>= 0
    b >>>= 0
    c >>>= 0
    d >>>= 0
    let t = (a + b) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    d = (d + 1) | 0
    t = (t + d) | 0
    c = (c + t) | 0
    return (t >>> 0) / 4294967296
  }

  // Discard the first outputs; sfc32 is weakly mixed right after seeding.
  for (let i = 0; i < 12; i++) next()

  return {
    next,
    int(lo: number, hi: number): number {
      if (!Number.isInteger(lo) || !Number.isInteger(hi) || hi < lo) {
        throw new RangeError(`rng.int: bad range [${lo}, ${hi}]`)
      }
      return lo + Math.floor(next() * (hi - lo + 1))
    },
  }
}
