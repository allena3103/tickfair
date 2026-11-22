/**
 * `breakingNews` (owner only): fires one news event on demand for demos.
 * Same pipeline as the cron task. Billing goes to the owner through
 * `tools.integration`, so only the owner may reach the paid call.
 */

import type { ActionContext, ActionHandler, ActionResult } from 'deepspace/worker'
import { TICKERS } from '../shared/contracts.js'
import type { NewsDraw, RejectCode, Ticker } from '../shared/contracts.js'
import type { Env } from '../../worker.js'
import { createRng, drawNewsEvent } from '../engine/market/index.js'
import type { IntegrationInvoke } from '../server/news/llm.js'
import type { PublishResult } from '../server/news/publish.js'
import { latestNewsAt, runNewsEvent } from '../server/news/runtime.js'
import { drawFor, randomSalt } from '../server/news/tick.js'

export const BREAKING_NEWS_COOLDOWN_MS = 10_000

function reject(code: RejectCode): ActionResult {
  return { success: false, error: code }
}

export interface BreakingNewsDeps {
  /** Engine draw for an optional forced ticker. */
  draw: (ticker: Ticker | undefined, now: number) => NewsDraw
  run: (env: Env, draw: NewsDraw, invoke: IntegrationInvoke) => Promise<PublishResult>
  latestNewsAt: (env: Env) => Promise<number>
  now: () => number
}

export function makeBreakingNews(deps: BreakingNewsDeps): ActionHandler<Env> {
  // In-isolate gate, set before the paid call so failed generations count too.
  // `latestNewsAt` covers other isolates for calls that did publish.
  let lastCallAt = 0

  return async ({ userId, params, tools, env }: ActionContext<Env>) => {
    if (!env.OWNER_USER_ID || userId !== env.OWNER_USER_ID) return reject('forbidden')

    const { ticker } = params
    if (ticker !== undefined && (typeof ticker !== 'string' || !(TICKERS as readonly string[]).includes(ticker))) {
      return reject('invalid_ticker')
    }

    const now = deps.now()
    if (now - lastCallAt < BREAKING_NEWS_COOLDOWN_MS) return reject('rate_limited')
    if (now - (await deps.latestNewsAt(env)) < BREAKING_NEWS_COOLDOWN_MS) return reject('rate_limited')
    lastCallAt = now

    const invoke: IntegrationInvoke = async (endpoint, body) => {
      const res = await tools.integration(endpoint, body)
      if (!res.success) throw new Error(res.code ?? res.error)
      return res.data
    }
    const result = await deps.run(env, deps.draw(ticker as Ticker | undefined, now), invoke)
    if (result.status === 'skipped') {
      // A validation skip is not a client error; report it without a RejectCode.
      if (result.reason === 'round_closed') return reject('round_closed')
      return { success: true, data: { published: false, reason: result.reason } }
    }
    return {
      success: true,
      data: { published: true, newsId: result.newsId, headline: result.headline, shocked: result.status === 'published' },
    }
  }
}

/** Registered in src/actions/index.ts by the director: `breakingNews`. */
export const breakingNews: ActionHandler<Env> = makeBreakingNews({
  draw: (ticker, now) => drawFor({ createRng, drawNewsEvent }, ticker, now, randomSalt()),
  run: runNewsEvent,
  latestNewsAt,
  now: Date.now,
})
