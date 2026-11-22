/**
 * Client calls to the order server actions. Identity is the bearer JWT the
 * worker verifies (ctx.userId); nothing identifying goes in the body.
 */

import { getAuthToken } from 'deepspace'
import type { CancelOrderParams, PlaceOrderData, PlaceOrderParams } from '@/shared/contracts'

export type ActionOutcome<T> = { ok: true; data: T } | { ok: false; code: string }

async function callAction<T>(name: string, params: unknown): Promise<ActionOutcome<T>> {
  let token: string | null
  try {
    token = await getAuthToken()
  } catch {
    token = null
  }
  if (!token) return { ok: false, code: 'signed_out' }
  let res: Response
  try {
    res = await fetch(`/api/actions/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(params),
    })
  } catch {
    return { ok: false, code: 'network' }
  }
  const json = (await res.json().catch(() => null)) as { success?: boolean; data?: T; error?: unknown } | null
  if (json?.success === true) return { ok: true, data: json.data as T }
  if (res.status === 401) return { ok: false, code: 'signed_out' }
  return { ok: false, code: typeof json?.error === 'string' ? json.error : `http_${res.status}` }
}

export function placeOrder(params: PlaceOrderParams) {
  return callAction<PlaceOrderData>('placeOrder', params)
}

export function cancelOrder(params: CancelOrderParams) {
  return callAction<Record<string, never>>('cancelOrder', params)
}

/** Messages for failures that are not exchange reject codes. */
export function transportMessage(code: string): string | null {
  if (code === 'signed_out') return 'Your session expired. Sign in again.'
  if (code === 'network') return 'Could not reach the exchange. Check your connection.'
  if (code.startsWith('http_')) return 'The exchange had a problem. Try again.'
  return null
}
