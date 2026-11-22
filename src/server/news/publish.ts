/**
 * Publish order (PLAN §6): validated text → `news` record → shock.
 * Anything that fails before the record is written is a skip, and a skip
 * never shocks (fail closed). Everyone sees the headline before any price
 * effect because the shock is sent only after the write succeeds.
 */

import type { ExchangeShockRequest, ExchangeShockResponse, NewsDraw, NewsRecord } from '../../shared/contracts.js'
import { generateNews } from './generate.js'
import type { GenerateDeps } from './generate.js'

export interface PublishDeps extends GenerateDeps {
  roundId: string
  newId: () => string
  writeNews: (newsId: string, record: NewsRecord) => Promise<void>
  shock: (req: ExchangeShockRequest) => Promise<ExchangeShockResponse>
  log: (line: string) => void
}

export type PublishResult =
  | { status: 'published'; newsId: string; headline: string }
  /** The headline is out but the exchange refused the shock (round ended mid-flight). */
  | { status: 'published_no_shock'; newsId: string; headline: string; reason: string }
  | { status: 'skipped'; reason: string }

export async function publishNews(draw: NewsDraw, deps: PublishDeps): Promise<PublishResult> {
  const gen = await generateNews(draw, deps)
  if (!gen.ok) {
    deps.log(`[news] skipped ${gen.reason}${gen.detail ? `: ${gen.detail}` : ''}`)
    return { status: 'skipped', reason: gen.reason }
  }

  const newsId = deps.newId()
  const { item } = gen
  try {
    await deps.writeNews(newsId, {
      roundId: deps.roundId,
      ticker: item.ticker,
      headline: item.headline,
      body: item.body,
      publishedAt: item.publishedAt,
    })
  } catch (err) {
    deps.log(`[news] skipped write_failed: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown'}`)
    return { status: 'skipped', reason: 'write_failed' }
  }

  let reason: string
  try {
    const res = await deps.shock({ newsId, ticker: draw.ticker, deltaBps: draw.deltaBps, rampBatches: draw.rampBatches })
    if (res.ok) {
      deps.log(`[news] published ${newsId} ${item.ticker}: ${item.headline}`)
      return { status: 'published', newsId, headline: item.headline }
    }
    reason = res.code
  } catch (err) {
    reason = `shock_failed: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown'}`
  }
  deps.log(`[news] published ${newsId} without shock (${reason})`)
  return { status: 'published_no_shock', newsId, headline: item.headline, reason }
}
