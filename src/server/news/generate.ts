/**
 * Turns an engine-drawn news event into validated headline text.
 *
 * The engine decides ticker, direction, and size; the LLM only writes words.
 * The impact size in bps never goes into the prompt or the result.
 */

import type { NewsDraw, Ticker } from '../../shared/contracts.js'
import { COMPANIES } from './companies.js'
import { MAX_BODY_CHARS, MAX_HEADLINE_CHARS, validateReply } from './validate.js'
import type { SkipReason } from './validate.js'

export interface LlmRequest {
  system: string
  user: string
}

/** Returns the model's text reply. Throws on transport or billing failure. */
export type CallLLM = (req: LlmRequest) => Promise<string>

export interface GenerateDeps {
  callLLM: CallLLM
  now: () => number
}

export interface NewsItem {
  ticker: Ticker
  headline: string
  body: string
  publishedAt: number
}

export type GenerateResult =
  | { ok: true; item: NewsItem }
  | { ok: false; reason: SkipReason; detail?: string }

const SYSTEM = [
  'You write one short wire-service news item for a stock-trading game with three fictional companies.',
  'Never mention real companies, real people, real stock tickers, real exchanges, or real products.',
  'Do not state prices or percentage moves.',
  'Reply with strict JSON only, no prose and no code fences:',
  `{"headline": string (at most ${MAX_HEADLINE_CHARS} characters), "body": string (at most 2 sentences, at most ${MAX_BODY_CHARS} characters), "sentiment": "positive" | "negative"}.`,
  'Set "sentiment" to the tone of the item you actually wrote, judged from its text.',
].join(' ')

export function buildPrompt(draw: NewsDraw): LlmRequest {
  const { name, sector } = COMPANIES[draw.ticker]
  const tone = draw.direction === 1 ? 'good' : 'bad'
  const weight = draw.size === 'major' ? 'significant, market-moving' : 'minor, routine'
  const user = [
    `Company: ${name} (ticker ${draw.ticker}), a fictional ${sector} company.`,
    `Write ${weight} ${tone} news for this company's investors.`,
    'Mention the company by name.',
  ].join(' ')
  return { system: SYSTEM, user }
}

export async function generateNews(draw: NewsDraw, deps: GenerateDeps): Promise<GenerateResult> {
  let reply: string
  try {
    reply = await deps.callLLM(buildPrompt(draw))
  } catch (err) {
    return { ok: false, reason: 'llm_error', detail: err instanceof Error ? err.message.slice(0, 200) : 'unknown' }
  }
  const checked = validateReply(reply, draw)
  if (!checked.ok) return { ok: false, reason: checked.reason }
  return { ok: true, item: { ticker: draw.ticker, ...checked.news, publishedAt: deps.now() } }
}
