/**
 * Real sector headlines from NewsAPI, used only as style inspiration for the
 * fictional news item. They never decide anything: the engine has already
 * picked the ticker, direction, and size. A failed or empty fetch means the
 * item is written without inspiration, so this never blocks news.
 */

import type { Ticker } from '../../shared/contracts.js'
import type { IntegrationInvoke } from './llm.js'

export const INSPIRATION_ENDPOINT = 'newsapi/top-headlines'
/** NewsAPI has no energy category; VOLT takes general business news. */
export const SECTOR_CATEGORY: Record<Ticker, string> = {
  ORBT: 'technology',
  CURA: 'health',
  VOLT: 'business',
}
export const INSPIRATION_COUNT = 3
export const INSPIRATION_MAX_CHARS = 120
/** One paid fetch per ticker per hour at most; real headlines change slowly. */
export const INSPIRATION_TTL_MS = 60 * 60_000

export type Inspiration = (ticker: Ticker) => Promise<string[]>

/**
 * Article titles end in " - Source"; drop it (exactly, when the source name is
 * known, else from the last " - "), then strip anything that could break out
 * of the prompt line or hide text: control and format characters (zero-width,
 * bidi, soft hyphen) and quotes.
 */
export function cleanTitle(title: unknown, source?: unknown): string {
  if (typeof title !== 'string') return ''
  const suffix = typeof source === 'string' && source ? ` - ${source}` : ''
  const noSource = suffix && title.endsWith(suffix) ? title.slice(0, -suffix.length) : title.replace(/\s+-\s+(?:(?!\s+-\s+).)+$/, '')
  return Array.from(
    noSource
      .replace(/[\p{Cc}\p{Cf}"`]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  )
    .slice(0, INSPIRATION_MAX_CHARS)
    .join('')
    .trim()
}

/**
 * Reads `{ articles: [...] }`, also when wrapped in a `data` envelope.
 * Returns null when there is no `articles` array, so the caller can log it.
 */
export function pickTitles(data: unknown): string[] | null {
  const root = data as { articles?: unknown; data?: { articles?: unknown } } | null
  const articles = root?.articles ?? root?.data?.articles
  if (!Array.isArray(articles)) return null
  const out: string[] = []
  for (const a of articles) {
    const article = a as { title?: unknown; source?: { name?: unknown } } | null
    const t = cleanTitle(article?.title, article?.source?.name)
    if (t && !t.includes('[Removed]') && !out.includes(t)) out.push(t)
    if (out.length === INSPIRATION_COUNT) break
  }
  return out
}

export type InspirationCache = Map<Ticker, { at: number; titles: string[] }>

/**
 * Caches per ticker for `INSPIRATION_TTL_MS`, including empty results, so a
 * NewsAPI outage costs about one failed call per ticker per hour in each
 * isolate (two events missing the cache at the same moment both fetch).
 * Never throws. Pass a long-lived cache; each news event builds a new `invoke`.
 */
export function makeInspiration(
  invoke: IntegrationInvoke,
  cache: InspirationCache,
  now: () => number,
  log: (line: string) => void,
): Inspiration {
  return async (ticker) => {
    const hit = cache.get(ticker)
    if (hit && now() - hit.at < INSPIRATION_TTL_MS) return hit.titles
    let titles: string[] = []
    try {
      const picked = pickTitles(await invoke(INSPIRATION_ENDPOINT, { country: 'us', category: SECTOR_CATEGORY[ticker], pageSize: 10 }))
      if (picked) titles = picked
      else log('[news] inspiration unavailable: unrecognized response shape')
    } catch (err) {
      log(`[news] inspiration unavailable: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown'}`)
    }
    cache.set(ticker, { at: now(), titles })
    return titles
  }
}
