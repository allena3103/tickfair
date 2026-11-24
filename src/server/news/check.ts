/**
 * A second, independent AI check (Cloudflare Jev) on a headline that already
 * passed `validateReply`. It asks three questions about the text alone: is it
 * about the drawn company, does its tone match the drawn direction, and does it
 * name anything real. Any failure, including a transport error or an answer
 * shape we don't recognize, is a skip, and a skip never shocks (fail closed).
 */

import type { NewsDraw } from '../../shared/contracts.js'
import { COMPANIES } from './companies.js'
import type { IntegrationInvoke } from './llm.js'
import type { ValidNews } from './validate.js'

export const CHECK_ENDPOINT = 'cloudflare/jev'
/** Measured on real calls: on-topic items score ~0.9+, a clean item names nothing real at ~0.3, a real brand ~0.96. */
export const MIN_ABOUT_COMPANY = 0.7
export const MIN_TONE = 0.7
export const MAX_REAL_ENTITY = 0.5

export type CheckSkipReason = 'check_error' | 'check_off_topic' | 'check_wrong_tone' | 'check_real_entity'
export type CheckResult = { ok: true } | { ok: false; reason: CheckSkipReason; detail?: string }
export type CheckNews = (draw: NewsDraw, news: ValidNews) => Promise<CheckResult>

export function buildCheckRequest(draw: NewsDraw, news: ValidNews): Record<string, unknown> {
  const { name } = COMPANIES[draw.ticker]
  return {
    state: { fictional_company: `${name} (ticker ${draw.ticker})`, headline: news.headline, body: news.body },
    questions: {
      about_company: {
        type: 'noul',
        instructions: 'Is the news item mainly about the fictional company named in fictional_company?',
      },
      tone: {
        type: 'choice',
        instructions: "For that company's investors, is this news item good, bad, or neither?",
        criteria: { good: null, bad: null, neutral: null },
      },
      real_entities: {
        type: 'noul',
        instructions:
          'Apart from the fictional company and generic terms (like GPU, FDA, CEO, data center), does the news item name a real-world company, brand, person, product, or stock ticker?',
      },
    },
  }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Reads `{ answers: {...} }`, also when wrapped in a `data` envelope. */
export function judge(draw: NewsDraw, data: unknown): CheckResult {
  const root = data as { answers?: unknown; data?: { answers?: unknown } } | null
  const answers = (root?.answers ?? root?.data?.answers) as Record<string, Record<string, unknown> | undefined> | undefined
  const about = num(answers?.about_company?.noul)
  const real = num(answers?.real_entities?.noul)
  const probs = answers?.tone?.probabilities as Record<string, unknown> | undefined
  const want = draw.direction === 1 ? 'good' : 'bad'
  const tone = num(probs?.[want])
  if (about === null || real === null || tone === null) return { ok: false, reason: 'check_error', detail: 'unrecognized answer shape' }
  if (about < MIN_ABOUT_COMPANY) return { ok: false, reason: 'check_off_topic' }
  if (answers?.tone?.choice !== want || tone < MIN_TONE) return { ok: false, reason: 'check_wrong_tone' }
  if (real > MAX_REAL_ENTITY) return { ok: false, reason: 'check_real_entity' }
  return { ok: true }
}

export function makeCheckNews(invoke: IntegrationInvoke): CheckNews {
  return async (draw, news) => {
    let data: unknown
    try {
      data = await invoke(CHECK_ENDPOINT, buildCheckRequest(draw, news))
    } catch (err) {
      return { ok: false, reason: 'check_error', detail: err instanceof Error ? err.message.slice(0, 200) : 'unknown' }
    }
    return judge(draw, data)
  }
}
