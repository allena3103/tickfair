/**
 * One run of the `news` cron task and one `breakingNews` draw. The engine's
 * `createRng` / `drawNewsEvent` are passed in, so this file stays free of
 * engine imports and is unit-testable.
 */

import type { NewsDraw, Ticker } from '../../shared/contracts.js'
import type { Env } from '../../../worker.js'
import type { IntegrationInvoke } from './llm.js'
import type { PublishResult } from './publish.js'

export const NEWS_FIRE_PROBABILITY = 0.5

export interface RngLike {
  next(): number
}

export interface DrawFns<R extends RngLike = RngLike> {
  createRng: (seed: string) => R
  drawNewsEvent: (rng: R) => NewsDraw
}

/**
 * Per-minute seed with a server-only random salt. The minute alone (plus the
 * public app id) would let a player who reads the bundle predict which minutes
 * fire and the direction of the news, and trade ahead of it.
 */
export function minuteSeed(now: number, salt: string): string {
  return `news:${Math.floor(now / 60_000)}:${salt}`
}

export function randomSalt(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export interface TickDeps<R extends RngLike> extends DrawFns<R> {
  run: (env: Env, draw: NewsDraw, invoke: IntegrationInvoke) => Promise<PublishResult>
  invoke: IntegrationInvoke
  now: number
  salt: string
  log: (line: string) => void
}

export async function newsTick<R extends RngLike>(env: Env, deps: TickDeps<R>): Promise<PublishResult | null> {
  const rng = deps.createRng(minuteSeed(deps.now, deps.salt))
  if (rng.next() >= NEWS_FIRE_PROBABILITY) {
    deps.log('[news] no event this minute')
    return null
  }
  return deps.run(env, deps.drawNewsEvent(rng), deps.invoke)
}

/** Draw for `breakingNews`: the engine picks direction and size; the owner may pin the ticker. */
export function drawFor<R extends RngLike>(fns: DrawFns<R>, ticker: Ticker | undefined, now: number, salt: string): NewsDraw {
  const draw = fns.drawNewsEvent(fns.createRng(`breaking:${now}:${salt}`))
  return ticker ? { ...draw, ticker } : draw
}
