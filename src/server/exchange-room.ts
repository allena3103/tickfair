/**
 * ExchangeRoom — the single source of truth for money (PLAN §3).
 *
 * This is the foundation SHELL. It establishes the room's two surfaces so the
 * rest of the app can code against them:
 *
 *  - WebSocket `/ws/exchange/:roomId` (routed by src/server/realtime-routes.ts).
 *    Identity comes only from the JWT-verified headers BaseRoom parses; a
 *    connection without a token is an anonymous spectator. Clients send
 *    nothing on this socket — orders go through server actions.
 *  - Internal HTTP `POST /exchange/{order,cancel,shock}`, reachable only by DO
 *    stub fetch from the worker (never publicly routed).
 *
 * CONTRACT PLACEHOLDER: until exchange-runtime implements matching, every
 * internal endpoint answers `{ ok: false, code: 'round_closed' }`. That is the
 * honest answer for "no round is running"; nothing pretends to trade.
 */

import { BaseRoom } from 'deepspace/worker'
import type { UserAttachment } from 'deepspace/worker'
import type {
  ExchangeCancelResponse,
  ExchangeOrderResponse,
  ExchangeServerMsg,
  ExchangeShockResponse,
} from '../shared/contracts.js'
import type { Env } from '../../worker.js'

export class ExchangeRoom extends BaseRoom<Env> {
  /** Clients send nothing on this socket; any inbound message is ignored. */
  protected onMessage(_ws: WebSocket, _user: UserAttachment, _message: { type: string }): void {}

  protected async onRequest(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (request.method !== 'POST') return new Response('Not Found', { status: 404 })

    switch (pathname) {
      case '/exchange/order':
        return Response.json({ ok: false, code: 'round_closed' } satisfies ExchangeOrderResponse)
      case '/exchange/cancel':
        return Response.json({ ok: false, code: 'round_closed' } satisfies ExchangeCancelResponse)
      case '/exchange/shock':
        return Response.json({ ok: false, code: 'round_closed' } satisfies ExchangeShockResponse)
      default:
        return new Response('Not Found', { status: 404 })
    }
  }

  /** BaseRoom's send helpers are typed to the SDK protocol; exchange messages use their own union. */
  protected sendExchange(ws: WebSocket, msg: ExchangeServerMsg): void {
    try {
      ws.send(JSON.stringify(msg))
    } catch {
      // Socket already closing; the client resyncs from ex.snapshot on reconnect.
    }
  }

  protected broadcastExchange(msg: ExchangeServerMsg): void {
    const payload = JSON.stringify(msg)
    for (const ws of this.getWebSockets()) {
      try {
        ws.send(payload)
      } catch {
        // Ignore one bad socket so the sweep reaches the rest.
      }
    }
  }
}
