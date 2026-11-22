import { describe, expect, it, vi } from 'vitest'
import type { ExchangeShockRequest, NewsDraw, NewsRecord } from '../../shared/contracts.js'
import type { Env } from '../../../worker.js'
import { buildPrompt, generateNews } from './generate.js'
import { extractText, makeCallLLM, NEWS_ENDPOINT, NEWS_MAX_TOKENS, NEWS_MODEL } from './llm.js'
import { publishNews } from './publish.js'
import type { PublishDeps } from './publish.js'
import { countSentences, validateReply } from './validate.js'
import { drawFor, minuteSeed, newsTick } from './tick.js'

const UP: NewsDraw = { ticker: 'ORBT', direction: 1, size: 'major', deltaBps: 600, rampBatches: 15 }
const DOWN: NewsDraw = { ticker: 'CURA', direction: -1, size: 'minor', deltaBps: -150, rampBatches: 12 }

const reply = (o: Record<string, unknown>) => JSON.stringify(o)
const GOOD = reply({
  headline: 'Orbital Compute lands record GPU cluster contract',
  body: 'Orbital Compute signed its largest data-center deal to date. Analysts expect revenue to climb next quarter.',
  sentiment: 'positive',
})

describe('validateReply', () => {
  it('accepts a valid reply and trims whitespace', () => {
    const r = validateReply(GOOD, UP)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.news.headline).toBe('Orbital Compute lands record GPU cluster contract')
  })

  it('accepts JSON wrapped in code fences', () => {
    expect(validateReply('```json\n' + GOOD + '\n```', UP).ok).toBe(true)
  })

  const bad: [string, string, NewsDraw, string][] = [
    ['invalid JSON', 'Orbital Compute soars!', UP, 'invalid_json'],
    ['truncated JSON', GOOD.slice(0, 40), UP, 'invalid_json'],
    ['missing sentiment', reply({ headline: 'Orbital Compute up', body: 'Orbital Compute wins.' }), UP, 'missing_fields'],
    ['headline too long', reply({ headline: 'Orbital Compute ' + 'x'.repeat(80), body: 'Orbital Compute wins.', sentiment: 'positive' }), UP, 'headline_too_long'],
    ['body too long', reply({ headline: 'Orbital Compute up', body: 'Orbital Compute ' + 'a'.repeat(280), sentiment: 'positive' }), UP, 'body_too_long'],
    ['three sentences with a quote', reply({ headline: 'Orbital Compute up', body: 'Orbital Compute shipped. "Demand is strong." Margins rose.', sentiment: 'positive' }), UP, 'too_many_sentences'],
    ['three sentences', reply({ headline: 'Orbital Compute up', body: 'Orbital Compute wins. It grows. It hires.', sentiment: 'positive' }), UP, 'too_many_sentences'],
    ['real ticker', reply({ headline: 'Orbital Compute beats NVDA on chips', body: 'Orbital Compute wins.', sentiment: 'positive' }), UP, 'unknown_ticker'],
    ['real ticker with $', reply({ headline: 'Orbital Compute tops $AAPL', body: 'Orbital Compute wins.', sentiment: 'positive' }), UP, 'unknown_ticker'],
    ['real company name', reply({ headline: 'Orbital Compute partners with Microsoft', body: 'Orbital Compute wins.', sentiment: 'positive' }), UP, 'real_company'],
    ['invented company', reply({ headline: 'Orbital Compute buys Zentrix Corp', body: 'Orbital Compute wins.', sentiment: 'positive' }), UP, 'real_company'],
    ['wrong company', reply({ headline: 'Voltgrid Energy expands grid', body: 'Voltgrid Energy wins.', sentiment: 'positive' }), UP, 'off_topic'],
    ['wrong sentiment', reply({ headline: 'Curaline Bio trial succeeds', body: 'Curaline Bio wins.', sentiment: 'positive' }), DOWN, 'wrong_sentiment'],
    ['garbage sentiment', reply({ headline: 'Orbital Compute up', body: 'Orbital Compute wins.', sentiment: 'bullish' }), UP, 'wrong_sentiment'],
  ]
  it.each(bad)('rejects %s', (_name, text, draw, reason) => {
    expect(validateReply(text, draw)).toEqual({ ok: false, reason })
  })

  it('allows in-game tickers and common acronyms', () => {
    const r = validateReply(
      reply({ headline: 'CURA: FDA halts Curaline Bio trial', body: 'The FDA paused the study after Q3 data.', sentiment: 'negative' }),
      DOWN,
    )
    expect(r.ok).toBe(true)
  })

  it('counts sentences without splitting decimals', () => {
    expect(countSentences('Output rose 4.5% this year. More soon.')).toBe(2)
    expect(countSentences('No terminator')).toBe(1)
    expect(countSentences('Orbital Compute shipped. "Demand is strong." Margins rose.')).toBe(3)
    expect(countSentences('Orbital Compute shipped. “Demand is strong.” Margins rose.')).toBe(3)
    expect(countSentences('Orbital Compute shipped (on time.) Margins rose.')).toBe(2)
  })
})

describe('buildPrompt', () => {
  it('names the company, sector, direction and size but never the bps', () => {
    const p = buildPrompt(UP)
    expect(p.user).toContain('Orbital Compute')
    expect(p.user).toContain('tech')
    expect(p.user).toContain('good')
    expect(p.user).toContain('significant')
    expect(`${p.system} ${p.user}`).not.toContain('600')
    expect(buildPrompt(DOWN).user).toContain('bad')
  })
})

describe('generateNews', () => {
  it('returns a NewsItem for a valid reply', async () => {
    const r = await generateNews(UP, { callLLM: async () => GOOD, now: () => 1234 })
    expect(r).toEqual({
      ok: true,
      item: {
        ticker: 'ORBT',
        headline: 'Orbital Compute lands record GPU cluster contract',
        body: 'Orbital Compute signed its largest data-center deal to date. Analysts expect revenue to climb next quarter.',
        publishedAt: 1234,
      },
    })
  })

  it('maps a thrown LLM call to llm_error', async () => {
    const r = await generateNews(UP, { callLLM: async () => { throw new Error('insufficient_credits') }, now: () => 0 })
    expect(r).toMatchObject({ ok: false, reason: 'llm_error' })
  })
})

describe('llm wrapper', () => {
  it('pins model, max_tokens, and endpoint', async () => {
    const invoke = vi.fn(async () => ({ content: [{ type: 'text', text: 'hi' }] }))
    const out = await makeCallLLM(invoke)({ system: 's', user: 'u' })
    expect(out).toBe('hi')
    expect(invoke).toHaveBeenCalledWith(NEWS_ENDPOINT, expect.objectContaining({
      model: NEWS_MODEL,
      max_tokens: NEWS_MAX_TOKENS,
      system: 's',
      messages: [{ role: 'user', content: 'u' }],
    }))
    expect(NEWS_MODEL).toBe('claude-haiku-4-5')
    expect(NEWS_MAX_TOKENS).toBeLessThanOrEqual(300)
  })

  it('extracts text from the shapes it may see', () => {
    expect(extractText('raw')).toBe('raw')
    expect(extractText({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] })).toBe('ab')
    expect(extractText({ choices: [{ message: { content: 'c' } }] })).toBe('c')
    expect(extractText({ text: 't' })).toBe('t')
    expect(extractText({ data: { content: [{ text: 'd' }] } })).toBe('d')
    expect(() => extractText({ foo: 1 })).toThrow()
    expect(() => extractText(null)).toThrow()
  })
})

function publishDeps(llmReply: string | Error, overrides: Partial<PublishDeps> = {}) {
  const writes: [string, NewsRecord][] = []
  const shocks: ExchangeShockRequest[] = []
  const logs: string[] = []
  const deps: PublishDeps = {
    roundId: 'r1',
    callLLM: async () => {
      if (llmReply instanceof Error) throw llmReply
      return llmReply
    },
    now: () => 5000,
    newId: () => 'news_1',
    writeNews: vi.fn(async (id: string, rec: NewsRecord) => { writes.push([id, rec]) }),
    shock: vi.fn(async (req: ExchangeShockRequest) => { shocks.push(req); return { ok: true as const } }),
    log: (l) => logs.push(l),
    ...overrides,
  }
  return { deps, writes, shocks, logs }
}

describe('publishNews', () => {
  it('writes the record, then shocks, with no impact size in the record', async () => {
    const order: string[] = []
    const { deps, writes, shocks } = publishDeps(GOOD, {})
    const w = deps.writeNews
    const s = deps.shock
    deps.writeNews = async (...a) => { order.push('write'); await w(...a) }
    deps.shock = async (r) => { order.push('shock'); return s(r) }

    const r = await publishNews(UP, deps)
    expect(r).toEqual({ status: 'published', newsId: 'news_1', headline: 'Orbital Compute lands record GPU cluster contract' })
    expect(order).toEqual(['write', 'shock'])
    expect(writes[0][0]).toBe('news_1')
    expect(writes[0][1]).toEqual({
      roundId: 'r1', ticker: 'ORBT', headline: 'Orbital Compute lands record GPU cluster contract',
      body: expect.any(String), publishedAt: 5000,
    })
    expect(JSON.stringify(writes[0][1])).not.toMatch(/600|deltaBps|ramp/)
    expect(shocks).toEqual([{ newsId: 'news_1', ticker: 'ORBT', deltaBps: 600, rampBatches: 15 }])
  })

  const invalid: [string, string | Error][] = [
    ['invalid JSON', 'not json'],
    ['headline too long', reply({ headline: 'Orbital Compute ' + 'x'.repeat(90), body: 'Orbital Compute.', sentiment: 'positive' })],
    ['real ticker', reply({ headline: 'Orbital Compute vs TSLA', body: 'Orbital Compute.', sentiment: 'positive' })],
    ['wrong sentiment', reply({ headline: 'Orbital Compute slumps', body: 'Orbital Compute.', sentiment: 'negative' })],
    ['LLM failure', new Error('boom')],
  ]
  it.each(invalid)('never shocks or writes on %s and logs the skip', async (_n, llmReply) => {
    const { deps, logs } = publishDeps(llmReply)
    const r = await publishNews(UP, deps)
    expect(r.status).toBe('skipped')
    expect(deps.shock).not.toHaveBeenCalled()
    expect(deps.writeNews).not.toHaveBeenCalled()
    expect(logs[0]).toMatch(/^\[news\] skipped /)
  })

  it('does not shock when the record write fails', async () => {
    const { deps, logs } = publishDeps(GOOD, { writeNews: vi.fn(async () => { throw new Error('room down') }) })
    const r = await publishNews(UP, deps)
    expect(r).toEqual({ status: 'skipped', reason: 'write_failed' })
    expect(deps.shock).not.toHaveBeenCalled()
    expect(logs[0]).toMatch(/^\[news\] skipped write_failed/)
  })

  it('passes a signed (negative) deltaBps through unchanged', async () => {
    const down = reply({ headline: 'Curaline Bio trial halted', body: 'Curaline Bio paused its lead study.', sentiment: 'negative' })
    const { deps, shocks } = publishDeps(down)
    expect((await publishNews(DOWN, deps)).status).toBe('published')
    expect(shocks).toEqual([{ newsId: 'news_1', ticker: 'CURA', deltaBps: -150, rampBatches: 12 }])
  })

  it('reports a refused shock without throwing', async () => {
    const { deps } = publishDeps(GOOD, { shock: vi.fn(async () => ({ ok: false as const, code: 'round_closed' as const })) })
    expect(await publishNews(UP, deps)).toMatchObject({ status: 'published_no_shock', reason: 'round_closed' })
  })
})

describe('newsTick', () => {
  const env = {} as Env
  const fakeRng = (v: number) => () => ({ next: () => v })
  const base = {
    drawNewsEvent: () => UP,
    invoke: async () => '',
    now: 120_000,
    salt: 's',
    log: () => {},
  }

  it('fires when the per-minute draw is below 0.5', async () => {
    const run = vi.fn(async () => ({ status: 'skipped' as const, reason: 'round_closed' }))
    await newsTick(env, { ...base, createRng: fakeRng(0.49), run })
    expect(run).toHaveBeenCalledWith(env, UP, base.invoke)
  })

  it('does nothing (no paid call) when the draw is 0.5 or more', async () => {
    const run = vi.fn()
    expect(await newsTick(env, { ...base, createRng: fakeRng(0.5), run })).toBeNull()
    expect(run).not.toHaveBeenCalled()
  })

  it('seeds per minute with a salt', () => {
    expect(minuteSeed(60_000, 'a')).toBe(minuteSeed(119_999, 'a'))
    expect(minuteSeed(60_000, 'a')).not.toBe(minuteSeed(120_000, 'a'))
    expect(minuteSeed(60_000, 'a')).not.toBe(minuteSeed(60_000, 'b'))
  })

  it('works with the real engine draw and stays in bounds', async () => {
    const { createRng, drawNewsEvent } = await import('../../engine/market/index.js')
    for (let i = 0; i < 200; i++) {
      const d = drawFor({ createRng, drawNewsEvent }, undefined, i, 'salt')
      expect(Math.sign(d.deltaBps)).toBe(d.direction)
      expect(Math.abs(d.deltaBps)).toBeGreaterThanOrEqual(100)
      expect(Math.abs(d.deltaBps)).toBeLessThanOrEqual(800)
    }
    expect(drawFor({ createRng, drawNewsEvent }, 'VOLT', 1, 'x').ticker).toBe('VOLT')
  })

  it('drawFor pins the ticker but keeps the engine draw', () => {
    const fns = { createRng: fakeRng(0), drawNewsEvent: () => UP }
    expect(drawFor(fns, 'VOLT', 0, 's')).toEqual({ ...UP, ticker: 'VOLT' })
    expect(drawFor(fns, undefined, 0, 's')).toEqual(UP)
  })
})
