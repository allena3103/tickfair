/**
 * Binds the news pipeline to the worker env: the live round lookup, the
 * `news` record write, and the shock sent to the ExchangeRoom stub.
 */

import type { ExchangeShockRequest, ExchangeShockResponse, NewsDraw, NewsRecord, RoundRecord } from '../../shared/contracts.js'
import type { Env } from '../../../worker.js'
import { makeCallLLM } from './llm.js'
import type { IntegrationInvoke } from './llm.js'
import { publishNews } from './publish.js'
import type { PublishResult } from './publish.js'

interface ToolResponse<T> {
  success?: boolean
  error?: string
  data?: T
}

/** RecordRoom tools call as the owner with RBAC off (see LESSONS.md #2). */
async function recordTool<T>(env: Env, tool: string, params: Record<string, unknown>): Promise<T> {
  const stub = env.RECORD_ROOMS.get(env.RECORD_ROOMS.idFromName(`app:${env.DEEPSPACE_APP_ID}`))
  const res = await stub.fetch(
    new Request('https://internal/api/tools/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': env.OWNER_USER_ID,
        'X-App-Action': 'true',
      },
      body: JSON.stringify({ tool, params }),
    }),
  )
  const json = (await res.json()) as ToolResponse<T>
  if (!json.success) throw new Error(`${tool} failed: ${json.error ?? `HTTP ${res.status}`}`)
  return json.data as T
}

/** The most recent round whose status is `live`, or null. */
export async function findLiveRoundId(env: Env): Promise<string | null> {
  const data = await recordTool<{ records?: { recordId: string; data: RoundRecord }[] }>(env, 'records.query', {
    collection: 'rounds',
    where: { status: 'live' },
    orderBy: 'startsAt',
    orderDir: 'desc',
    limit: 1,
  })
  return data.records?.[0]?.recordId ?? null
}

/** `publishedAt` of the newest `news` record, or 0. */
export async function latestNewsAt(env: Env): Promise<number> {
  const data = await recordTool<{ records?: { data: NewsRecord }[] }>(env, 'records.query', {
    collection: 'news',
    orderBy: 'publishedAt',
    orderDir: 'desc',
    limit: 1,
  })
  return Number(data.records?.[0]?.data.publishedAt ?? 0)
}

async function writeNews(env: Env, newsId: string, record: NewsRecord): Promise<void> {
  await recordTool(env, 'records.create', { collection: 'news', recordId: newsId, data: record })
}

async function sendShock(env: Env, req: ExchangeShockRequest): Promise<ExchangeShockResponse> {
  const ns = env.EXCHANGE_ROOMS
  const stub = ns.get(ns.idFromName(`exchange:${env.DEEPSPACE_APP_ID}`))
  const res = await stub.fetch(
    new Request('https://exchange.internal/exchange/shock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    }),
  )
  return (await res.json()) as ExchangeShockResponse
}

/**
 * Runs one news event end to end. Checks for a live round first so no paid
 * call is made between rounds.
 */
export async function runNewsEvent(env: Env, draw: NewsDraw, invoke: IntegrationInvoke): Promise<PublishResult> {
  const roundId = await findLiveRoundId(env)
  if (!roundId) {
    console.log('[news] skipped round_closed')
    return { status: 'skipped', reason: 'round_closed' }
  }
  return publishNews(draw, {
    roundId,
    callLLM: makeCallLLM(invoke),
    now: Date.now,
    newId: () => `news_${crypto.randomUUID()}`,
    writeNews: (id, record) => writeNews(env, id, record),
    shock: (req) => sendShock(env, req),
    log: (line) => console.log(line),
  })
}
