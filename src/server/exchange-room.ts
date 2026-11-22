/**
 * ExchangeRoom — the single source of truth for money (PLAN §3).
 *
 * This Durable Object is a thin shell around `ExchangeCore` (exchange/core.ts):
 * it supplies the clock, the alarm, the sockets, and the RecordRoom mirror.
 *
 *  - WebSocket `/ws/exchange/:roomId` (routed by src/server/realtime-routes.ts).
 *    Identity comes only from the JWT-verified headers BaseRoom parses; a
 *    connection without a token is an anonymous spectator. The room sends
 *    `ex.snapshot` on connect, `ex.batch` per batch, `ex.phase` on round
 *    transitions. Clients send nothing on this socket.
 *  - Internal HTTP `POST /exchange/{order,cancel,shock}`, reachable only by DO
 *    stub fetch from the worker (never publicly routed). The caller's userId
 *    in the body is trusted because only server actions (ctx.userId from a
 *    verified JWT) can reach this path.
 *
 * Alarm: every BATCH_MS while a round is live. It pauses after IDLE_PAUSE_MS
 * with no open sockets and no orders, except for one wake at the round's end
 * so the round closes on time. The next request or socket resumes it.
 * Each tick commits the batch first, then broadcasts, then mirrors.
 */

import { BaseRoom } from 'deepspace/worker'
import type { UserAttachment } from 'deepspace/worker'
import { BATCH_MS, type ExchangeServerMsg } from '../shared/contracts.js'
import type { Env } from '../../worker.js'
import { roundDurations, type DurationEnv } from './exchange/config.js'
import { ExchangeCore } from './exchange/core.js'
import { flushMirror, nextDueAt, type MirrorWrite } from './exchange/mirror.js'

const WS_OPEN = 1

export class ExchangeRoom extends BaseRoom<Env> {
  private readonly core: ExchangeCore
  private flushing = false

  constructor(state: DurableObjectState, env: Env) {
    super(state, env)
    this.core = new ExchangeCore({
      sql: this.sql,
      txn: (fn) => this.state.storage.transactionSync(fn),
      durations: roundDurations(env as Env & DurationEnv),
      newId: () => crypto.randomUUID(),
      log: (line) => console.log(line),
      logError: (line) => console.error(line),
    })
  }

  /** Clients send nothing on this socket; any inbound message is ignored. */
  protected onMessage(_ws: WebSocket, _user: UserAttachment, _message: { type: string }): void {}

  protected async onConnect(ws: WebSocket, _user: UserAttachment): Promise<void> {
    await this.ensureAwake(true)
    this.sendExchange(ws, this.core.snapshot())
  }

  protected async onRequest(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (request.method !== 'POST') return new Response('Not Found', { status: 404 })
    const body: unknown = await request.json().catch(() => null)

    switch (pathname) {
      case '/exchange/order':
        await this.ensureAwake(true)
        return Response.json(this.core.placeOrder(Date.now(), body))
      case '/exchange/cancel':
        await this.ensureAwake(true)
        return Response.json(this.core.cancelOrder(Date.now(), body))
      case '/exchange/shock': {
        // A shock is not player activity: news alone must not keep an empty room awake.
        await this.ensureAwake(false)
        const res = this.core.shock(Date.now(), body)
        return Response.json(res, { status: !res.ok && res.code === 'bad_request' ? 400 : 200 })
      }
      default:
        return new Response('Not Found', { status: 404 })
    }
  }

  protected async onAlarm(): Promise<void> {
    const now = Date.now()
    const sockets = this.openSockets()
    if (sockets > 0) this.core.touch(now)
    const idle = this.core.isIdle(now, sockets)

    this.broadcastAll(this.core.tick(now, idle))

    // Re-arm before the slow mirror flush, so a failed flush can't stop the clock.
    let at = this.core.nextWakeAt(idle)
    // Queued mirror rows keep the alarm going (even while idle) until they are delivered.
    const due = nextDueAt(this.sql)
    if (due !== null) at = Math.min(at ?? Number.POSITIVE_INFINITY, Math.max(due, now + BATCH_MS))
    if (at !== null) await this.state.storage.setAlarm(at)

    await this.flush()
  }

  /** Catch up rounds, broadcast any phase change, and make sure an alarm is armed. */
  private async ensureAwake(activity: boolean): Promise<void> {
    this.broadcastAll(this.core.wake(Date.now(), activity))
    const at = this.core.nextWakeAt(this.core.isIdle(Date.now(), this.openSockets()))
    if (at === null) return
    const current = await this.state.storage.getAlarm()
    if (current === null || current > at) await this.state.storage.setAlarm(at)
  }

  private async flush(): Promise<void> {
    if (this.flushing) return
    this.flushing = true
    try {
      const r = await flushMirror(this.sql, (w) => this.writeRecord(w), (line) => console.warn(line), Date.now())
      if (r.failed > 0) console.warn(`[exchange] mirror ${r.failed} failed this tick, ${r.left} queued`)
    } finally {
      this.flushing = false
    }
  }

  /** Upsert one record by its known id (SPIKE S3 / LESSONS 2). */
  private async writeRecord(w: MirrorWrite): Promise<void> {
    const ns = this.env.RECORD_ROOMS
    const res = await ns.get(ns.idFromName(`app:${this.env.DEEPSPACE_APP_ID}`)).fetch(
      new Request('https://internal/api/tools/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': w.actor || this.env.OWNER_USER_ID,
          'X-App-Action': 'true',
        },
        body: JSON.stringify({ tool: 'records.create', params: { collection: w.collection, recordId: w.recordId, data: w.data } }),
      }),
    )
    const json = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null
    if (!json?.success) throw new Error(json?.error ?? `HTTP ${res.status}`)
  }

  /** A closing socket still shows up briefly; count only open ones (LESSONS 6). */
  private openSockets(): number {
    return this.getWebSockets().filter((ws) => ws.readyState === WS_OPEN).length
  }

  private broadcastAll(msgs: ExchangeServerMsg[]): void {
    for (const msg of msgs) this.broadcastExchange(msg)
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
