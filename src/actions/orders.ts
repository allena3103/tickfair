/**
 * Order entry actions (PLAN §3 "Order intake path").
 *
 * The trader is always `ctx.userId` from the verified JWT; any userId in the
 * params is dropped. Params are type- and range-checked here so junk never
 * reaches the room; money rules (cash, band, caps, self-cross, rate limit) are
 * enforced by ExchangeRoom, which is the only place that knows balances and
 * re-checks everything.
 */

import type { ActionHandler, ActionResult } from 'deepspace/worker'
import { TICKERS } from '../shared/contracts.js'
import { MAX_ORDER_QTY } from '../engine/core/index.js'
import type {
  ExchangeCancelRequest,
  ExchangeCancelResponse,
  ExchangeOrderRequest,
  ExchangeOrderResponse,
  PlaceOrderData,
  PlaceOrderParams,
  RejectCode,
  Ticker,
} from '../shared/contracts.js'
import type { Env } from '../../worker.js'

function exchangeStub(env: Env) {
  const ns = env.EXCHANGE_ROOMS
  return ns.get(ns.idFromName(`exchange:${env.DEEPSPACE_APP_ID}`))
}

async function callExchange<T>(env: Env, path: string, body: unknown): Promise<T> {
  const res = await exchangeStub(env).fetch(
    new Request(`https://exchange.internal${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
  return (await res.json()) as T
}

function reject(code: RejectCode): ActionResult {
  return { success: false, error: code }
}

const isPositiveInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0

/** No fictional stock is anywhere near $1M a share; anything above is a typo or an attack. */
export const MAX_LIMIT_CENTS = 100_000_000
/** Server-generated order ids are `o-<uuid>`. */
const ORDER_ID = /^o-[0-9a-f-]{36}$/

/** Shape and range check. Returns the clean params or the reject code. */
export function parsePlaceOrder(raw: unknown): PlaceOrderParams | RejectCode {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'invalid_ticker'
  const { ticker, side, type, qty, limitCents } = raw as Record<string, unknown>
  if (typeof ticker !== 'string' || !(TICKERS as readonly string[]).includes(ticker)) return 'invalid_ticker'
  if (side !== 'buy' && side !== 'sell') return 'invalid_side'
  if (type !== 'limit' && type !== 'market') return 'invalid_type'
  if (!isPositiveInt(qty) || qty > MAX_ORDER_QTY) return 'invalid_qty'
  if (type === 'limit') {
    if (!isPositiveInt(limitCents) || limitCents > MAX_LIMIT_CENTS) return 'invalid_price'
    return { ticker: ticker as Ticker, side, type, qty, limitCents }
  }
  // Market orders carry no limit; the engine prices them at the band edge.
  if (limitCents !== undefined) return 'invalid_price'
  return { ticker: ticker as Ticker, side, type, qty }
}

/** Shown on the public leaderboard. A lookup failure must not block trading. */
async function displayNameFor(tools: Parameters<ActionHandler<Env>>[0]['tools'], userId: string): Promise<string> {
  try {
    const res = await tools.get<{ displayName?: string; name?: string }>('users', userId)
    const data = res.success ? res.data.record?.data : undefined
    const name = typeof data?.displayName === 'string' && data.displayName ? data.displayName : data?.name
    return (typeof name === 'string' && name.trim() ? name.trim() : 'Trader').slice(0, 40)
  } catch {
    return 'Trader'
  }
}

/** Order ids from the client are checked for shape before the room sees them. */
export function parseCancel(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { orderId } = raw as Record<string, unknown>
  return typeof orderId === 'string' && ORDER_ID.test(orderId) ? orderId : null
}

export const placeOrder: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const parsed = parsePlaceOrder(params)
  if (typeof parsed === 'string') return reject(parsed)

  const body: ExchangeOrderRequest = {
    userId,
    displayName: await displayNameFor(tools, userId),
    params: parsed,
  }
  const res = await callExchange<ExchangeOrderResponse>(env, '/exchange/order', body)
  if (!res.ok) return reject(res.code)
  return { success: true, data: res.data satisfies PlaceOrderData }
}

export const cancelOrder: ActionHandler<Env> = async ({ userId, params, env }) => {
  const orderId = parseCancel(params)
  if (!orderId) return reject('not_found')

  const body: ExchangeCancelRequest = { userId, orderId }
  const res = await callExchange<ExchangeCancelResponse>(env, '/exchange/cancel', body)
  if (!res.ok) return reject(res.code)
  return { success: true, data: {} }
}
