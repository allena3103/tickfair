/**
 * Checks an LLM reply before it can become a headline. Every check fails
 * closed: anything unexpected is a skip, and a skip means no price shock.
 */

import { TICKERS } from '../../shared/contracts.js'
import type { NewsDraw } from '../../shared/contracts.js'
import { COMPANIES } from './companies.js'

export const MAX_HEADLINE_CHARS = 90
export const MAX_BODY_CHARS = 280
export const MAX_BODY_SENTENCES = 2

export type SkipReason =
  | 'llm_error'
  | 'invalid_json'
  | 'missing_fields'
  | 'headline_too_long'
  | 'body_too_long'
  | 'too_many_sentences'
  | 'real_company'
  | 'unknown_ticker'
  | 'off_topic'
  | 'wrong_sentiment'

export interface ValidNews {
  headline: string
  body: string
}

/** Real companies and brands most likely to leak into finance-flavored text. */
const REAL_NAMES = [
  'apple', 'microsoft', 'google', 'alphabet', 'amazon', 'meta', 'facebook', 'tesla', 'nvidia',
  'netflix', 'intel', 'oracle', 'ibm', 'samsung', 'sony', 'openai', 'anthropic', 'spacex',
  'boeing', 'airbus', 'pfizer', 'moderna', 'merck', 'johnson & johnson', 'novartis', 'roche',
  'astrazeneca', 'eli lilly', 'exxon', 'exxonmobil', 'chevron', 'shell', ' bp ', 'totalenergies',
  'berkshire', 'jpmorgan', 'goldman sachs', 'morgan stanley', 'blackrock', 'walmart', 'disney',
  'qualcomm', 'broadcom', 'salesforce', 'adobe', 'uber', 'palantir', 'tsmc', 'siemens', 'nasdaq',
  'nyse', 'dow jones', 's&p',
]

/**
 * All-caps tokens that may appear in a headline. Any other 2–5 letter
 * all-caps token looks like a ticker (real or invented) and is refused, which
 * also enforces "only the three in-game tickers appear".
 */
const ALLOWED_CAPS = new Set<string>([
  ...TICKERS,
  'CEO', 'CFO', 'CTO', 'COO', 'FDA', 'EPA', 'AI', 'GPU', 'CPU', 'EV', 'EVS', 'R&D', 'IPO', 'EPS',
  'Q1', 'Q2', 'Q3', 'Q4', 'US', 'USA', 'EU', 'UK', 'GW', 'MW', 'KW', 'GWH', 'MWH', 'KWH', 'II',
  'III', 'IV', 'API', 'SEC', 'M&A', 'ESG', 'LNG', 'CO2',
])

const COMPANY_SUFFIX = /\b([A-Z][\w&-]*(?:\s+[A-Z][\w&-]*){0,2})\s+(?:Inc|Corp|Corporation|Ltd|LLC|PLC|Holdings|Group|Co)\b\.?/g

/** Pulls `{...}` out of a reply that may be wrapped in prose or code fences. */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
}

/**
 * Sentence count: terminators, optionally followed by closing quotes or
 * brackets, then whitespace or the end ("4.5%" is not a break). A final
 * sentence with no terminator still counts.
 */
export function countSentences(text: string): number {
  const t = text.trim()
  if (!t) return 0
  const terminated = t.match(/[.!?]+["'”’)\]]*(?=\s|$)/g)?.length ?? 0
  const openEnded = /[.!?]+["'”’)\]]*$/.test(t) ? 0 : 1
  return terminated + openEnded
}

function mentionsRealCompany(text: string): boolean {
  const padded = ` ${text.toLowerCase().replace(/[^\w&\s]/g, ' ')} `
  return REAL_NAMES.some((name) => {
    const needle = name.trim()
    return new RegExp(`(^|[^\\w])${needle.replace(/[&.]/g, '\\$&')}($|[^\\w])`).test(padded)
  })
}

function hasUnknownCaps(text: string): boolean {
  const tokens = text.match(/\$?\b[A-Z][A-Z0-9&]{1,4}\b/g) ?? []
  return tokens.some((t) => !ALLOWED_CAPS.has(t.replace(/^\$/, '')))
}

function mentionsOtherCompany(text: string, allowed: string[]): boolean {
  for (const m of text.matchAll(COMPANY_SUFFIX)) {
    const name = m[1]
    if (!allowed.some((a) => name.endsWith(a) || a.endsWith(name))) return true
  }
  return false
}

export function validateReply(
  reply: string,
  draw: NewsDraw,
): { ok: true; news: ValidNews } | { ok: false; reason: SkipReason } {
  const parsed = extractJson(reply)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, reason: 'invalid_json' }
  const { headline, body, sentiment } = parsed as Record<string, unknown>
  if (typeof headline !== 'string' || typeof body !== 'string' || typeof sentiment !== 'string') {
    return { ok: false, reason: 'missing_fields' }
  }
  const h = headline.replace(/\s+/g, ' ').trim()
  const b = body.replace(/\s+/g, ' ').trim()
  if (!h || !b) return { ok: false, reason: 'missing_fields' }
  if (h.length > MAX_HEADLINE_CHARS) return { ok: false, reason: 'headline_too_long' }
  if (b.length > MAX_BODY_CHARS) return { ok: false, reason: 'body_too_long' }
  if (countSentences(b) > MAX_BODY_SENTENCES) return { ok: false, reason: 'too_many_sentences' }

  const text = `${h} ${b}`
  if (mentionsRealCompany(text)) return { ok: false, reason: 'real_company' }
  if (hasUnknownCaps(text)) return { ok: false, reason: 'unknown_ticker' }
  const names = Object.values(COMPANIES).map((c) => c.name)
  if (mentionsOtherCompany(text, names)) return { ok: false, reason: 'real_company' }

  const subject = COMPANIES[draw.ticker].name
  const firstWord = subject.split(' ')[0]
  if (!text.includes(subject) && !text.includes(firstWord) && !text.includes(draw.ticker)) {
    return { ok: false, reason: 'off_topic' }
  }

  const want = draw.direction === 1 ? 'positive' : 'negative'
  if (sentiment.trim().toLowerCase() !== want) return { ok: false, reason: 'wrong_sentiment' }

  return { ok: true, news: { headline: h, body: b } }
}
