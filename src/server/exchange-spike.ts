/**
 * TEMPORARY spike harness (S1–S3). Reverted after SPIKE.md is written; kept in
 * git history for reference. Not part of the shipped shell.
 */
import { isAnonymousUserId } from 'deepspace/worker'
import type { UserAttachment } from 'deepspace/worker'
import { ExchangeRoom } from './exchange-room.js'

const IDLE_STOP_MS = 60_000

type ToolResult = { success: boolean; error?: string; data?: Record<string, any> }
export class SpikeExchangeRoom extends ExchangeRoom {
  private ensureTables() {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS spike_meta (k TEXT PRIMARY KEY, v TEXT)`)
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS spike_ticks (seq INTEGER PRIMARY KEY, scheduled REAL, fired REAL, sockets INTEGER)`,
    )
  }
  private get(k: string): string | null {
    this.ensureTables()
    const r = this.sql.exec(`SELECT v FROM spike_meta WHERE k=?`, k).toArray()[0]
    return r ? String(r.v) : null
  }
  private set(k: string, v: string | number) {
    this.ensureTables()
    this.sql.exec(`INSERT OR REPLACE INTO spike_meta (k,v) VALUES (?,?)`, k, String(v))
  }

  protected async onConnect(ws: WebSocket, user: UserAttachment): Promise<void> {
    ws.send(JSON.stringify({ type: 'spike.hello', userId: user.userId, anonymous: isAnonymousUserId(user.userId) }))
    this.set('lastSocketAt', Date.now())
    if ((await this.state.storage.getAlarm()) === null) {
      const at = Date.now() + 1000
      this.set('nextAt', at)
      this.set('stoppedAt', '')
      await this.state.storage.setAlarm(at)
    }
  }

  protected onDisconnect(): void {
    this.set('lastSocketAt', Date.now())
  }

  protected async onAlarm(): Promise<void> {
    const fired = Date.now()
    const scheduled = Number(this.get('nextAt') ?? fired)
    // Sockets mid-close still appear briefly; count only OPEN ones.
    const sockets = this.getWebSockets().filter((ws) => ws.readyState === 1).length
    const seq = Number(this.get('seq') ?? 0) + 1
    this.set('seq', seq)
    this.sql.exec(
      `INSERT INTO spike_ticks (seq, scheduled, fired, sockets) VALUES (?,?,?,?)`,
      seq,
      scheduled,
      fired,
      sockets,
    )
    const tick = JSON.stringify({ type: 'spike.tick', seq, scheduled, fired })
    for (const ws of this.getWebSockets()) {
      try {
        ws.send(tick)
      } catch {
        /* closing */
      }
    }
    if (sockets > 0) this.set('lastSocketAt', fired)

    const job = this.get('s3job')
    if (job) {
      this.set('s3job', '')
      this.set('s3result', JSON.stringify(await this.runS3(Number(job))))
    }

    const idleFor = fired - Number(this.get('lastSocketAt') ?? fired)
    if (sockets === 0 && idleFor >= IDLE_STOP_MS) {
      this.set('stoppedAt', fired)
      return // do not re-arm
    }
    const next = Math.max(Date.now() + 1, scheduled + 1000)
    this.set('nextAt', next)
    await this.state.storage.setAlarm(next)
  }

  private async tool(userId: string, tool: string, params: Record<string, unknown>): Promise<ToolResult> {
    const stub = this.env.RECORD_ROOMS.get(this.env.RECORD_ROOMS.idFromName(`app:${this.env.DEEPSPACE_APP_ID}`))
    const res = await stub.fetch(
      new Request('https://internal/api/tools/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId, 'X-App-Action': 'true' },
        body: JSON.stringify({ tool, params }),
      }),
    )
    return (await res.json()) as ToolResult
  }

  private tapeRow(round: string, ticker: string, i: number) {
    return {
      collection: 'tape',
      recordId: `${round}:${ticker}:${i}`,
      data: { ticker, roundId: round, batchId: i, clearCents: 1000, volume: 1, seed: 'x', at: Date.now() },
    }
  }

  /** Write n tape rows with known ids from inside the alarm; measure; verify upsert + userBound; clean up. */
  private async runS3(n: number) {
    const owner = this.env.OWNER_USER_ID
    const round = `__spike__${Date.now()}`
    const errors: string[] = []

    const t0 = Date.now()
    const results = await Promise.allSettled(
      Array.from({ length: n }, (_, i) => this.tool(owner, 'records.create', this.tapeRow(round, 'ORBT', i))),
    )
    const parallelMs = Date.now() - t0
    for (const r of results) {
      if (r.status === 'rejected') errors.push(String(r.reason))
      else if (!r.value.success) errors.push(String(r.value.error))
    }

    const t1 = Date.now()
    for (let i = 0; i < n; i++) {
      try {
        const r = await this.tool(owner, 'records.create', this.tapeRow(round, 'CURA', i))
        if (!r.success) errors.push(String(r.error))
      } catch (e) {
        errors.push(String(e))
      }
    }
    const sequentialMs = Date.now() - t1

    // Upsert: same recordId again with a new value → updated in place, no duplicate.
    const again = this.tapeRow(round, 'ORBT', 0)
    again.data.clearCents = 2222
    await this.tool(owner, 'records.create', again)
    const got = await this.tool(owner, 'records.get', { collection: 'tape', recordId: again.recordId })
    const q = await this.tool(owner, 'records.query', { collection: 'tape', where: { roundId: round }, limit: 1000 })

    // userBound: write an order as trader T (and try to claim the owner's id) → stored userId must be T.
    const orderId = `${round}-order`
    const orderData = {
      userId: owner, ticker: 'ORBT', side: 'buy', type: 'limit', qty: 1, limitCents: 1,
      filledQty: 0, avgFillCents: 0, status: 'open', batchId: 1, roundId: round,
    }
    await this.tool('spike-trader-T', 'records.create', { collection: 'orders', recordId: orderId, data: orderData })
    const order = await this.tool(owner, 'records.get', { collection: 'orders', recordId: orderId })
    // Upsert as owner must keep the userBound field.
    await this.tool(owner, 'records.create', { collection: 'orders', recordId: orderId, data: { status: 'filled', userId: owner } })
    const order2 = await this.tool(owner, 'records.get', { collection: 'orders', recordId: orderId })

    let deleted = 0
    for (;;) {
      const d = await this.tool(owner, 'records.deleteWhere', { collection: 'tape', where: { roundId: round }, limit: 500 })
      const k = Number(d.data?.deleted ?? 0)
      deleted += k
      if (k < 500) break
    }
    await this.tool(owner, 'records.delete', { collection: 'orders', recordId: orderId })

    return {
      n,
      parallelMs,
      sequentialMs,
      errorCount: errors.length,
      firstErrors: errors.slice(0, 3),
      upsertClearCents: got.data?.record?.data?.clearCents,
      rowsForRound: q.data?.records?.length,
      orderUserIdIsTrader: order.data?.record?.data?.userId === 'spike-trader-T',
      orderUserIdKeptAfterOwnerUpsert: order2.data?.record?.data?.userId === 'spike-trader-T',
      orderStatusAfterUpsert: order2.data?.record?.data?.status,
      deleted,
    }
  }

  protected async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/spike/status') {
      this.ensureTables()
      const ticks = this.sql.exec(`SELECT seq, scheduled, fired, sockets FROM spike_ticks ORDER BY seq`).toArray()
      return Response.json({
        alarm: await this.state.storage.getAlarm(),
        stoppedAt: this.get('stoppedAt'),
        lastSocketAt: this.get('lastSocketAt'),
        s3result: this.get('s3result'),
        s3job: this.get('s3job'),
        ticks,
      })
    }
    if (url.pathname === '/spike/s3' && request.method === 'POST') {
      const { n } = (await request.json()) as { n: number }
      this.set('s3result', '')
      this.set('s3job', n)
      if ((await this.state.storage.getAlarm()) === null) {
        this.set('nextAt', Date.now() + 10)
        await this.state.storage.setAlarm(Date.now() + 10)
      }
      return Response.json({ queued: n })
    }
    if (url.pathname === '/spike/reset' && request.method === 'POST') {
      this.ensureTables()
      this.sql.exec(`DELETE FROM spike_ticks`)
      this.sql.exec(`DELETE FROM spike_meta`)
      await this.state.storage.deleteAlarm()
      return Response.json({ reset: true })
    }
    return super.onRequest(request)
  }
}
