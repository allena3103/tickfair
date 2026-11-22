/**
 * Order entry actions (PLAN §3 "Order intake path").
 *
 * The trader is always `ctx.userId` from the verified JWT. Params are shape-
 * checked here; money rules (cash, band, caps, self-cross) are enforced by
 * ExchangeRoom, which is the only place that knows balances.
 *
 * Ownership moves to exchange-runtime in wave 2.
 */

import type { ActionHandler, ActionResult } from 'deepspace/worker'
import { TICKERS } from '../shared/contracts.js'
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

/** Shape check only. Returns the clean params or the reject code. */
export function parsePlaceOrder(raw: Record<string, unknown>): PlaceOrderParams | RejectCode {
  const { ticker, side, type, qty, limitCents } = raw
  if (typeof ticker !== 'string' || !(TICKERS as readonly string[]).includes(ticker)) return 'invalid_ticker'
  if (side !== 'buy' && side !== 'sell') return 'invalid_side'
  if (type !== 'limit' && type !== 'market') return 'invalid_type'
  if (!isPositiveInt(qty)) return 'invalid_qty'
  if (type === 'limit') {
    if (!isPositiveInt(limitCents)) return 'invalid_price'
    return { ticker: ticker as Ticker, side, type, qty, limitCents }
  }
  // Market orders carry no limit; the engine prices them at the band edge.
  if (limitCents !== undefined) return 'invalid_price'
  return { ticker: ticker as Ticker, side, type, qty }
}

async function displayNameFor(tools: Parameters<ActionHandler<Env>>[0]['tools'], userId: string): Promise<string> {
  const res = await tools.get<{ displayName?: string; name?: string }>('users', userId)
  const data = res.success ? res.data.record.data : undefined
  return (data?.displayName || data?.name || 'Trader').slice(0, 40)
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
  const { orderId } = params
  if (typeof orderId !== 'string' || orderId.length === 0 || orderId.length > 64) return reject('not_found')

  const body: ExchangeCancelRequest = { userId, orderId }
  const res = await callExchange<ExchangeCancelResponse>(env, '/exchange/cancel', body)
  if (!res.ok) return reject(res.code)
  return { success: true, data: {} }
}
