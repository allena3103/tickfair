/**
 * The exchange state machine: intake, batch clearing, bots, shocks, and the
 * round lifecycle. Everything here is synchronous SQL inside one transaction
 * per step, so a step either fully happens or not at all. The Durable Object
 * (exchange-room.ts) owns clocks, alarms, sockets, and the mirror flush; this
 * class only turns (state, now, request) into (new state, messages to send).
 *
 * Money rules come from engine-core (`checkAndReserve`, `settleFill`,
 * `releaseOrder`, `clearBatch`); prices and bots come from market-sim. Bots go
 * through exactly the same `submit` path as players.
 */
import {
  BATCH_MS,
  MAX_ORDERS_PER_BATCH,
  START_CASH_CENTS,
  TICKERS,
  type Depth,
  type ExchangeCancelResponse,
  type ExchangeOrderResponse,
  type ExchangeServerMsg,
  type ExchangeShockResponse,
  type OrderRecord,
  type PlaceOrderParams,
  type PortfolioRecord,
  type Print,
  type RejectCode,
  type Standing,
  type Ticker,
} from '../../shared/contracts.js'
import {
  checkAndReserve,
  clearBatch,
  emptyAccount,
  marketLimit,
  priceBand,
  releaseOrder,
  settleFill,
  type Account,
} from '../../engine/core/index.js'
import {
  INITIAL_PRICES,
  MM_BOT_ID,
  applyShock,
  createRng,
  initialBotState,
  initialFundamentals,
  marketMakerQuotes,
  noiseTraderOrders,
  stepFundamental,
} from '../../engine/market/index.js'
import { COMPANIES } from '../news/companies.js'
import {
  BOT_IDS,
  BOT_SEED,
  DEPTH_LEVELS,
  IDLE_PAUSE_MS,
  SNAPSHOT_PRINTS,
  TICKER_MIRROR_EVERY,
  isBotId,
  type Durations,
} from './config.js'
import { InvariantError, checkAccounts, checkConservation } from './invariants.js'
import { enqueue } from './mirror.js'
import { createTables, one, type SqlLike, type Txn } from './sql.js'
import {
  allAccountIds,
  allLiveOrders,
  clearRoundTables,
  depthLevels,
  displayNameOf,
  dropFinishedBotOrders,
  getOrder,
  insertAccount,
  insertOrder,
  insertPrint,
  liveOrdersForTicker,
  liveOrdersForUser,
  loadAccount,
  loadBotState,
  loadMarket,
  ordersInBatch,
  readMeta,
  recentPrints,
  saveAccount,
  saveBotState,
  saveMarket,
  saveOrder,
  setDisplayName,
  toBookOrder,
  totals,
  writeMeta,
  type MarketRow,
  type Meta,
  type OrderRow,
} from './store.js'

/** An alarm may fire a little early or late; a batch within this window of its time runs. */
const EARLY_MS = 25
/** Behind schedule by more than this means the alarm was paused (idle), not late. */
const RESUME_AFTER_MS = 2 * BATCH_MS
const MAX_NAME = 40

export interface CoreDeps {
  sql: SqlLike
  txn: Txn
  durations: Durations
  /** Random, unguessable id material (crypto.randomUUID in the DO). */
  newId: () => string
  log: (line: string) => void
  logError: (line: string) => void
}

/** Request bodies arrive as untyped JSON from the worker; the DO re-checks everything. */

type Msgs = ExchangeServerMsg[]

export class ExchangeCore {
  private readonly sql: SqlLike

  constructor(private readonly d: CoreDeps) {
    this.sql = d.sql
    createTables(d.sql)
  }

  meta(): Meta | null {
    return readMeta(this.sql)
  }

  // -------------------------------------------------------------------------
  // Clock-driven steps (called by the DO)
  // -------------------------------------------------------------------------

  /**
   * Bring the room up to date on any request, socket, or alarm: start the first
   * round, close a round whose time ran out while the room was idle, start the
   * next round after the break, and restart the batch clock after a pause.
   * `activity` is false for news shocks, so news alone never keeps an empty
   * room awake.
   */
  wake(now: number, activity = true): Msgs {
    const msgs = this.guarded(now, () => {
      // A fresh room always gets a lastActivityAt, even when a shock (not activity) woke it,
      // so the idle clock starts now instead of never.
      const fresh = !readMeta(this.sql)
      if (activity || fresh) writeMeta(this.sql, { lastActivityAt: now })
      return fresh ? this.openRound(now) : this.closeIfDue(now)
    })
    msgs.push(
      ...this.guarded(now, () => {
        const out = this.openIfDue(now, true)
        const m = this.mustMeta()
        if (m.phase === 'live' && now - m.nextBatchAt > RESUME_AFTER_MS) {
          writeMeta(this.sql, { nextBatchAt: now + BATCH_MS })
        }
        return out
      }),
    )
    return msgs
  }

  /**
   * One alarm tick. Awake: phase changes, then the batch if it is due.
   * Idle: only close a round whose time is up (so no `rounds` record stays
   * live), and never open a new one; the next request or socket does that.
   */
  tick(now: number, idle: boolean): Msgs {
    if (!readMeta(this.sql)) return []
    const msgs = this.guarded(now, () => this.closeIfDue(now))
    msgs.push(...this.guarded(now, () => this.openIfDue(now, !idle)))
    const m = this.mustMeta()
    if (!idle && m.phase === 'live' && !m.halted && now >= m.nextBatchAt - EARLY_MS) {
      msgs.push(...this.guarded(now, () => this.runBatch(now)))
    }
    return msgs
  }

  /** Record activity (an open socket) so the idle pause doesn't kick in. */
  touch(now: number): void {
    if (readMeta(this.sql)) writeMeta(this.sql, { lastActivityAt: now })
  }

  isIdle(now: number, openSockets: number): boolean {
    const m = readMeta(this.sql)
    if (!m) return true
    // A missing value (meta written before this field existed) counts as long ago, never as "not idle".
    const last = Number.isFinite(m.lastActivityAt) ? m.lastActivityAt : 0
    return openSockets === 0 && now - last >= IDLE_PAUSE_MS
  }

  /**
   * When the next alarm should fire, or null for none. Idle: only the end of
   * a live round (to close it on time); a break just waits for a visitor.
   */
  nextWakeAt(idle: boolean): number | null {
    const m = readMeta(this.sql)
    if (!m) return null
    if (m.phase === 'live') return idle ? m.phaseEndsAt : Math.min(m.nextBatchAt, m.phaseEndsAt)
    return idle ? null : m.phaseEndsAt
  }

  // -------------------------------------------------------------------------
  // Requests (POST /exchange/*)
  // -------------------------------------------------------------------------

  placeOrder(now: number, body: unknown): ExchangeOrderResponse {
    const b = asObject(body)
    const userId = b?.userId
    if (typeof userId !== 'string' || userId === '' || isBotId(userId)) return reject('forbidden')
    const params = asObject(b?.params)
    if (!params) return reject('invalid_ticker')
    const rawName = typeof b?.displayName === 'string' ? b.displayName.trim() : ''
    const displayName = (rawName || 'Trader').slice(0, MAX_NAME)

    return this.d.txn(() => {
      const m = readMeta(this.sql)
      if (!m || m.phase !== 'live' || m.halted || now >= m.phaseEndsAt) return reject('round_closed')
      writeMeta(this.sql, { lastActivityAt: now })
      this.enroll(userId, displayName, m.roundId)
      return this.submit(userId, params as unknown as PlaceOrderParams, m.batchId, m.roundId, loadMarket(this.sql))
    })
  }

  cancelOrder(now: number, body: unknown): ExchangeCancelResponse {
    const b = asObject(body)
    const userId = b?.userId
    const orderId = b?.orderId
    if (typeof userId !== 'string' || userId === '' || isBotId(userId)) return reject('forbidden')
    if (typeof orderId !== 'string' || orderId === '') return reject('not_found')

    return this.d.txn(() => {
      const m = readMeta(this.sql)
      const o = getOrder(this.sql, orderId)
      if (!m || !o) return reject('not_found')
      if (o.userId !== userId) return reject('not_owner')
      if (o.status === 'filled' || o.status === 'cancelled') return reject('already_final')
      if (m.phase !== 'live' || m.halted) return reject('round_closed')

      const acct = this.mustAccount(userId)
      saveAccount(this.sql, userId, releaseOrder(acct, toBookOrder(o)))
      o.status = 'cancelled'
      o.remaining = 0
      saveOrder(this.sql, o)
      writeMeta(this.sql, { lastActivityAt: now })
      this.mirrorOrder(o, m.roundId)
      this.mirrorPortfolio(userId, m.roundId)
      return { ok: true }
    })
  }

  /** A news shock moves the hidden target; the ramp starts at the next batch. Same newsId twice = once. */
  shock(now: number, body: unknown): ExchangeShockResponse {
    const b = asObject(body)
    const { newsId, ticker, deltaBps, rampBatches } = b ?? {}
    const valid =
      typeof newsId === 'string' && newsId !== '' && newsId.length <= 128 &&
      typeof ticker === 'string' && (TICKERS as readonly string[]).includes(ticker) &&
      Number.isSafeInteger(deltaBps) && Math.abs(deltaBps as number) <= 5_000 &&
      Number.isSafeInteger(rampBatches) && (rampBatches as number) >= 1 && (rampBatches as number) <= 100
    if (!valid) return { ok: false, code: 'bad_request' }

    return this.d.txn(() => {
      const m = readMeta(this.sql)
      if (!m || m.phase !== 'live' || m.halted || now >= m.phaseEndsAt) return { ok: false, code: 'round_closed' as const }
      if (one(this.sql, `SELECT newsId FROM shocks WHERE newsId = ?`, newsId)) return { ok: true as const }
      const market = loadMarket(this.sql)
      const t = ticker as Ticker
      market[t] = { ...market[t], ...applyShock(market[t], deltaBps as number, rampBatches as number) }
      saveMarket(this.sql, market)
      this.sql.exec(`INSERT INTO shocks (newsId, roundId, ticker, at) VALUES (?, ?, ?, ?)`, newsId, m.roundId, t, now)
      // The impact size is never logged or sent anywhere.
      this.d.log(`[exchange] shock ${newsId} ${t} accepted for batch ${m.batchId}`)
      return { ok: true as const }
    })
  }

  // -------------------------------------------------------------------------
  // Market data
  // -------------------------------------------------------------------------

  snapshot(): ExchangeServerMsg {
    const m = readMeta(this.sql)
    if (!m) {
      return {
        type: 'ex.snapshot', roundId: '', phase: 'break', phaseEndsAt: 0, batchId: 0, nextBatchAt: 0,
        last: { ...INITIAL_PRICES }, depth: emptyDepth(), recentPrints: [],
      }
    }
    return {
      type: 'ex.snapshot',
      roundId: m.roundId,
      phase: m.phase,
      phaseEndsAt: m.phaseEndsAt,
      batchId: m.batchId,
      nextBatchAt: m.nextBatchAt,
      last: lastOf(loadMarket(this.sql)),
      depth: this.depth(),
      recentPrints: recentPrints(this.sql, SNAPSHOT_PRINTS).map((p) => ({
        ticker: p.ticker, roundId: p.roundId, batchId: p.batchId, clearCents: p.clearCents, volume: p.volume, seed: p.seed,
      })),
    }
  }

  private depth(): Record<Ticker, Depth> {
    const out = emptyDepth()
    for (const l of depthLevels(this.sql)) {
      const level: [number, number] = [Number(l.price), Number(l.qty)]
      if (l.side === 'buy') out[l.ticker].bids.push(level)
      else out[l.ticker].asks.push(level)
    }
    for (const t of TICKERS) {
      out[t].bids = out[t].bids.sort((a, b) => b[0] - a[0]).slice(0, DEPTH_LEVELS)
      out[t].asks = out[t].asks.sort((a, b) => a[0] - b[0]).slice(0, DEPTH_LEVELS)
    }
    return out
  }

  // -------------------------------------------------------------------------
  // Rounds
  // -------------------------------------------------------------------------

  /*
   * Closing a round and opening the next are separate guarded steps (separate
   * transactions), so a failure while opening can never roll back, or
   * overwrite, the results of the round that just closed.
   */

  /** Close the live round if its time is up. Inside a transaction. */
  private closeIfDue(now: number): Msgs {
    const m = this.mustMeta()
    return m.phase === 'live' && now >= m.phaseEndsAt ? this.closeRound(now) : []
  }

  /** Open the next round if the break is over. Inside a transaction. */
  private openIfDue(now: number, mayOpen: boolean): Msgs {
    const m = this.mustMeta()
    return mayOpen && m.phase === 'break' && now >= m.phaseEndsAt ? this.openRound(now) : []
  }

  private openRound(now: number): Msgs {
    clearRoundTables(this.sql)
    const roundId = `r-${now.toString(36)}-${this.d.newId().replace(/-/g, '').slice(0, 6)}`
    const market = {} as Record<Ticker, MarketRow>
    const fundamentals = initialFundamentals()
    for (const t of TICKERS) {
      market[t] = { ...fundamentals[t], lastCents: INITIAL_PRICES[t], openCents: INITIAL_PRICES[t] }
    }
    saveMarket(this.sql, market)
    saveBotState(this.sql, MM_BOT_ID, initialBotState())
    for (const botId of BOT_IDS) {
      const seed = BOT_SEED[botId]
      const acct = emptyAccount(seed.cashCents)
      for (const t of TICKERS) acct.holdings[t].qty = seed.shares[t]
      insertAccount(this.sql, botId, roundId, botId === MM_BOT_ID ? 'Market maker' : 'Noise trader', acct)
    }

    const { liveMs } = this.d.durations
    writeMeta(this.sql, {
      roundId,
      phase: 'live',
      roundStartsAt: now,
      roundEndsAt: now + liveMs,
      phaseEndsAt: now + liveMs,
      batchId: 1,
      nextBatchAt: now + BATCH_MS,
      roundSecret: this.d.newId(),
      halted: 0,
    })
    enqueue(this.sql, {
      collection: 'rounds',
      recordId: roundId,
      data: { startsAt: now, endsAt: now + liveMs, status: 'live', standings: [], winnerId: '' },
    })
    this.mirrorTickers(market)
    // Bots quote into batch 1 so the first batch already has liquidity.
    this.quoteBots(1, this.mustMeta(), market)
    this.d.log(`[exchange] round ${roundId} live until ${new Date(now + liveMs).toISOString()}`)
    return [{ type: 'ex.phase', roundId, phase: 'live', phaseEndsAt: now + liveMs }]
  }

  /** Cancel everything, mark to market, publish standings. Inside a transaction. */
  private closeRound(now: number): Msgs {
    const m = this.mustMeta()
    const market = loadMarket(this.sql)
    const accounts = new Map<string, Account>()
    for (const o of allLiveOrders(this.sql)) {
      const acct = accounts.get(o.userId) ?? this.mustAccount(o.userId)
      accounts.set(o.userId, releaseOrder(acct, toBookOrder(o)))
      o.status = 'cancelled'
      o.remaining = 0
      saveOrder(this.sql, o)
      if (!isBotId(o.userId)) this.mirrorOrder(o, m.roundId)
    }
    for (const [userId, acct] of accounts) saveAccount(this.sql, userId, acct)
    dropFinishedBotOrders(this.sql)
    checkAccounts(this.sql, allAccountIds(this.sql))

    const standings: Standing[] = []
    for (const userId of allAccountIds(this.sql)) {
      if (isBotId(userId)) continue
      const acct = this.mustAccount(userId)
      let equityCents = acct.cashCents + acct.reservedCents
      for (const t of TICKERS) equityCents += acct.holdings[t].qty * market[t].lastCents
      standings.push({ userId, displayName: displayNameOf(this.sql, userId), equityCents })
      this.mirrorPortfolio(userId, m.roundId)
    }
    standings.sort((a, b) => b.equityCents - a.equityCents || (a.userId < b.userId ? -1 : 1))
    const winnerId = standings[0]?.userId ?? ''

    enqueue(this.sql, {
      collection: 'rounds',
      recordId: m.roundId,
      data: { startsAt: m.roundStartsAt, endsAt: m.roundEndsAt, status: 'done', standings, winnerId },
    })
    this.mirrorTickers(market)
    const phaseEndsAt = m.roundEndsAt + this.d.durations.breakMs
    writeMeta(this.sql, { phase: 'break', phaseEndsAt })
    this.d.log(`[exchange] round ${m.roundId} done at ${new Date(now).toISOString()}, ${standings.length} traders`)
    return [{ type: 'ex.phase', roundId: m.roundId, phase: 'break', phaseEndsAt }]
  }

  /**
   * Fail loud: the step that broke an invariant was rolled back. Stop trading
   * in this round (no standings, no winner) and let the next round start clean,
   * because the next round wipes every account.
   */
  private halt(now: number, detail: string): Msgs {
    const current = this.mustMeta()
    if (current.phase !== 'live') {
      // Failed while opening the next round. The previous round is already
      // closed and published: leave its record alone, keep the break, and
      // retry the open after another break.
      const retryAt = now + this.d.durations.breakMs
      this.d.logError(`[exchange] round open failed, retrying at ${retryAt}: ${detail}`)
      this.d.txn(() => writeMeta(this.sql, { phaseEndsAt: retryAt }))
      return [{ type: 'ex.phase', roundId: current.roundId, phase: 'break', phaseEndsAt: retryAt }]
    }
    this.d.logError(`[exchange] INVARIANT ${detail}`)
    return this.d.txn(() => {
      const m = this.mustMeta()
      for (const o of allLiveOrders(this.sql)) {
        o.status = 'cancelled'
        o.remaining = 0
        saveOrder(this.sql, o)
        if (!isBotId(o.userId)) this.mirrorOrder(o, m.roundId)
      }
      const phaseEndsAt = now + this.d.durations.breakMs
      writeMeta(this.sql, { halted: 1, phase: 'break', phaseEndsAt })
      enqueue(this.sql, {
        collection: 'rounds',
        recordId: m.roundId,
        data: { startsAt: m.roundStartsAt, endsAt: now, status: 'done', standings: [], winnerId: '' },
      })
      return [{ type: 'ex.phase', roundId: m.roundId, phase: 'break', phaseEndsAt }]
    })
  }

  /** Run `step` in a transaction; any throw rolls it back and halts the round. */
  private guarded(now: number, step: () => Msgs): Msgs {
    try {
      return this.d.txn(step)
    } catch (err) {
      const detail = err instanceof InvariantError ? err.message : `step failed: ${err instanceof Error ? err.message : String(err)}`
      if (!readMeta(this.sql)) throw err
      return this.halt(now, detail)
    }
  }

  // -------------------------------------------------------------------------
  // Batch
  // -------------------------------------------------------------------------

  /** Clear the open batch for every ticker, settle, step the market, re-quote bots. Inside a transaction. */
  private runBatch(now: number): Msgs {
    const m = this.mustMeta()
    const batchId = m.batchId
    const before = totals(this.sql)
    const market = loadMarket(this.sql)
    const bot = loadBotState(this.sql, MM_BOT_ID)
    const accounts = new Map<string, Account>()
    const humans = new Set<string>()
    const prints: Print[] = []

    for (const t of TICKERS) {
      const live = liveOrdersForTicker(this.sql, t)
      if (live.length === 0) continue
      const res = clearBatch({ roundId: m.roundId, ticker: t, batchId, lastCents: market[t].lastCents, orders: live.map(toBookOrder) })
      if (res.clearCents === null || res.volume === 0) continue

      const byId = new Map(live.map((o) => [o.orderId, o]))
      for (const f of res.fills) {
        const o = byId.get(f.orderId)
        if (!o) throw new InvariantError(`fill for unknown order ${f.orderId}`)
        const acct = accounts.get(f.traderId) ?? this.mustAccount(f.traderId)
        accounts.set(f.traderId, settleFill(acct, f, o.limitCents))
        o.remaining -= f.qty
        o.filledQty += f.qty
        o.fillValueCents += f.qty * f.priceCents
        o.status = o.remaining === 0 ? 'filled' : 'partial'
        saveOrder(this.sql, o)
        if (f.traderId === MM_BOT_ID) bot.inventory[t] += f.side === 'buy' ? f.qty : -f.qty
        if (!isBotId(f.traderId)) {
          humans.add(f.traderId)
          this.mirrorOrder(o, m.roundId)
          enqueue(this.sql, {
            collection: 'fills',
            recordId: `${o.orderId}:${batchId}`,
            actor: f.traderId,
            data: {
              userId: f.traderId, orderId: o.orderId, ticker: t, side: f.side, qty: f.qty,
              priceCents: f.priceCents, batchId, roundId: m.roundId,
            },
          })
        }
      }

      market[t].lastCents = res.clearCents
      const print: Print = { ticker: t, roundId: m.roundId, batchId, clearCents: res.clearCents, volume: res.volume, seed: res.seed }
      prints.push(print)
      insertPrint(this.sql, { ...print, at: now })
      enqueue(this.sql, { collection: 'tape', recordId: `${m.roundId}:${t}:${batchId}`, data: { ...print, at: now } })
    }
    for (const [userId, acct] of accounts) saveAccount(this.sql, userId, acct)
    checkConservation(before, totals(this.sql))

    // The hidden value moves after the clear, so this batch's price never used information it couldn't see.
    const walk = createRng(`${m.roundSecret}|fund|${batchId}`)
    for (const t of TICKERS) market[t] = { ...market[t], ...stepFundamental(market[t], walk) }
    saveMarket(this.sql, market)
    saveBotState(this.sql, MM_BOT_ID, bot)

    const next = batchId + 1
    let nextBatchAt = m.nextBatchAt + BATCH_MS
    if (nextBatchAt <= now) nextBatchAt = now + BATCH_MS
    writeMeta(this.sql, { batchId: next, nextBatchAt })
    // Bot quotes carry the NEW batch id, so they never get earlier-batch priority over players.
    this.quoteBots(next, this.mustMeta(), market)

    for (const userId of humans) this.mirrorPortfolio(userId, m.roundId)
    if (next % TICKER_MIRROR_EVERY === 0) this.mirrorTickers(market)

    checkAccounts(this.sql, new Set([...accounts.keys(), ...BOT_IDS]))
    checkConservation(before, totals(this.sql))

    return [{
      type: 'ex.batch', roundId: m.roundId, batchId: next, nextBatchAt,
      last: lastOf(market), depth: this.depth(), prints,
    }]
  }

  /**
   * Cancel the bots' old orders and submit fresh intents for `batchId`.
   * A rejected intent is logged and skipped; it never stops the batch (LESSONS 15).
   */
  private quoteBots(batchId: number, m: Meta, market: Record<Ticker, MarketRow>): void {
    for (const botId of BOT_IDS) {
      let acct = this.mustAccount(botId)
      for (const o of liveOrdersForUser(this.sql, botId)) {
        acct = releaseOrder(acct, toBookOrder(o))
        o.status = 'cancelled'
        o.remaining = 0
        saveOrder(this.sql, o)
      }
      saveAccount(this.sql, botId, acct)
    }
    dropFinishedBotOrders(this.sql)

    const last = lastOf(market)
    const state = loadBotState(this.sql, MM_BOT_ID)
    const mm = marketMakerQuotes(state, market, last, createRng(`${m.roundSecret}|mm|${batchId}`))
    const noise = noiseTraderOrders(last, createRng(`${m.roundSecret}|noise|${batchId}`))
    saveBotState(this.sql, MM_BOT_ID, mm.state)

    for (const intent of [...mm.intents, ...noise]) {
      const { lo, hi } = priceBand(last[intent.ticker])
      const limitCents = Math.min(hi, Math.max(lo, intent.limitCents))
      const res = this.submit(
        intent.botId,
        { ticker: intent.ticker, side: intent.side, type: 'limit', qty: intent.qty, limitCents },
        batchId,
        m.roundId,
        market,
      )
      if (!res.ok) this.d.log(`[exchange] bot intent skipped ${intent.botId} ${intent.ticker} ${intent.side} ${intent.qty}@${limitCents}: ${res.code}`)
    }
  }

  // -------------------------------------------------------------------------
  // Intake (shared by players and bots)
  // -------------------------------------------------------------------------

  /** Validate, rate-limit, reserve, and rest one order in `batchId`. Inside a transaction. */
  private submit(
    userId: string,
    p: PlaceOrderParams,
    batchId: number,
    roundId: string,
    market: Record<Ticker, MarketRow>,
  ): ExchangeOrderResponse {
    if (typeof p.ticker !== 'string' || !(TICKERS as readonly string[]).includes(p.ticker)) return reject('invalid_ticker')
    if (p.side !== 'buy' && p.side !== 'sell') return reject('invalid_side')
    if (p.type !== 'limit' && p.type !== 'market') return reject('invalid_type')
    if (ordersInBatch(this.sql, userId, batchId) >= MAX_ORDERS_PER_BATCH) return reject('rate_limited')

    const lastCents = market[p.ticker].lastCents
    // A market order is a limit order at the band edge; that edge is what gets stored.
    const limitCents = p.type === 'market' ? marketLimit(p.side, lastCents) : p.limitCents
    if (typeof limitCents !== 'number') return reject('invalid_price')

    const acct = this.mustAccount(userId)
    const open = liveOrdersForUser(this.sql, userId).map(toBookOrder)
    const r = checkAndReserve(acct, { side: p.side, ticker: p.ticker, qty: p.qty, limitCents }, { lastCents, openOrders: open })
    if (!r.ok) return reject(r.code)
    saveAccount(this.sql, userId, r.acct)

    const order: OrderRow = {
      orderId: `o-${this.d.newId()}`,
      userId,
      ticker: p.ticker,
      side: p.side,
      type: p.type,
      qty: p.qty,
      remaining: p.qty,
      limitCents,
      filledQty: 0,
      fillValueCents: 0,
      batchId,
      status: 'open',
    }
    insertOrder(this.sql, order)
    if (!isBotId(userId)) {
      this.mirrorOrder(order, roundId)
      this.mirrorPortfolio(userId, roundId)
    }
    return { ok: true, data: { orderId: order.orderId, batchId } }
  }

  /** A player joins the round with START_CASH_CENTS on their first action in it. */
  private enroll(userId: string, displayName: string, roundId: string): void {
    if (!loadAccount(this.sql, userId)) {
      insertAccount(this.sql, userId, roundId, displayName, emptyAccount(START_CASH_CENTS))
      this.mirrorPortfolio(userId, roundId)
    } else if (displayNameOf(this.sql, userId) !== displayName) {
      setDisplayName(this.sql, userId, displayName)
      this.mirrorPortfolio(userId, roundId)
    }
  }

  // -------------------------------------------------------------------------
  // Mirror helpers
  // -------------------------------------------------------------------------

  private mirrorOrder(o: OrderRow, roundId: string): void {
    const data: OrderRecord = {
      userId: o.userId,
      ticker: o.ticker,
      side: o.side,
      type: o.type,
      qty: o.qty,
      limitCents: o.limitCents,
      filledQty: o.filledQty,
      avgFillCents: o.filledQty > 0 ? Math.round(o.fillValueCents / o.filledQty) : 0,
      status: o.status,
      batchId: o.batchId,
      roundId,
    }
    enqueue(this.sql, { collection: 'orders', recordId: o.orderId, actor: o.userId, data })
  }

  /** `cashCents` is TOTAL cash (free + reserved for open buys), so equity = cash + shares × price. */
  private mirrorPortfolio(userId: string, roundId: string): void {
    const acct = this.mustAccount(userId)
    const holdings = {} as Record<Ticker, number>
    for (const t of TICKERS) holdings[t] = acct.holdings[t].qty
    const data: PortfolioRecord = {
      userId,
      displayName: displayNameOf(this.sql, userId),
      roundId,
      cashCents: acct.cashCents + acct.reservedCents,
      holdings,
    }
    enqueue(this.sql, { collection: 'portfolios', recordId: `${roundId}:${userId}`, data })
  }

  private mirrorTickers(market: Record<Ticker, MarketRow>): void {
    for (const t of TICKERS) {
      enqueue(this.sql, {
        collection: 'tickers',
        recordId: t,
        data: { symbol: t, name: COMPANIES[t].name, sector: COMPANIES[t].sector, lastCents: market[t].lastCents, openCents: market[t].openCents },
      })
    }
  }

  private mustMeta(): Meta {
    const m = readMeta(this.sql)
    if (!m) throw new Error('exchange meta missing')
    return m
  }

  private mustAccount(userId: string): Account {
    const a = loadAccount(this.sql, userId)
    if (!a) throw new InvariantError(`account ${userId} missing`)
    return a
  }
}

function reject(code: RejectCode): { ok: false; code: RejectCode } {
  return { ok: false, code }
}

function asObject(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function lastOf(market: Record<Ticker, MarketRow>): Record<Ticker, number> {
  const out = {} as Record<Ticker, number>
  for (const t of TICKERS) out[t] = market[t].lastCents
  return out
}

function emptyDepth(): Record<Ticker, Depth> {
  const out = {} as Record<Ticker, Depth>
  for (const t of TICKERS) out[t] = { bids: [], asks: [] }
  return out
}

