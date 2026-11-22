/**
 * /trade: the trading terminal (PLAN §8). Signed-in only.
 *
 * Live prices, depth, and phase come from the exchange socket
 * (useExchangeStream). The trader's own orders, fills, and portfolio come
 * from RecordRoom collections the exchange mirrors; orders and fills are
 * 'own'-read, so other traders' rows never reach this page.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuthStatus, useMutations, useQuery } from 'deepspace'
import {
  type FillRecord,
  type OrderRecord,
  type PortfolioRecord,
  type Ticker,
  type TickerRecord,
} from '@/shared/contracts'
import { useExchangeStream } from '@/hooks/useExchangeStream'
import { useFloorPresence } from '@/components/shell/FloorPresence'
import { NO_ROUND, useCurrentRound } from '@/components/shell/useCurrentRound'
import { Leaderboard } from '@/components/feed/Leaderboard'
import { NewsFeed } from '@/components/feed/NewsFeed'
import { OnlineTraders } from '@/components/feed/OnlineTraders'
import { Tape } from '@/components/feed/Tape'
import { BatchClock } from '@/components/trading/BatchClock'
import { DepthLadder } from '@/components/trading/DepthLadder'
import { MyFills, OpenOrders, Positions } from '@/components/trading/MyOrders'
import { OrderTicket } from '@/components/trading/OrderTicket'
import { PriceChart } from '@/components/trading/PriceChart'
import { RoundBreakOverlay } from '@/components/trading/RoundBreak'
import { TickerTabs } from '@/components/trading/TickerTabs'
import { isLiveOrder, portfolioView, readHoldings, reservedBy } from '@/components/trading/logic'

export default function TradePage() {
  const { userId } = useAuthStatus()
  const stream = useExchangeStream()
  const { ready } = useMutations('orders')
  const { setTicker: publishTicker } = useFloorPresence()
  const [ticker, setTicker] = useState<Ticker>('ORBT')

  useEffect(() => {
    publishTicker(ticker)
  }, [ticker, publishTicker])
  useEffect(() => () => publishTicker(null), [publishTicker])

  const roundId = stream.roundId || NO_ROUND

  const tickers = useQuery<TickerRecord>('tickers')
  const open = useMemo(() => {
    const out: Partial<Record<Ticker, number>> = {}
    for (const r of tickers.records) if (r.data.openCents > 0) out[r.recordId as Ticker] = r.data.openCents
    return out
  }, [tickers.records])

  // Last price: live stream, falling back to the mirrored tickers record.
  const last = useMemo(() => {
    const out: Partial<Record<Ticker, number>> = {}
    for (const r of tickers.records) if (r.data.lastCents > 0) out[r.recordId as Ticker] = r.data.lastCents
    return { ...out, ...stream.last }
  }, [tickers.records, stream.last])

  const orders = useQuery<OrderRecord>('orders', { where: { roundId }, limit: 200 })
  const openOrders = useMemo(
    () =>
      orders.records
        .filter((r) => r.data.userId === userId && isLiveOrder(r.data))
        .map((r) => ({ ...r.data, id: r.recordId }))
        .sort((a, b) => b.batchId - a.batchId || a.id.localeCompare(b.id)),
    [orders.records, userId],
  )

  const fills = useQuery<FillRecord>('fills', { where: { roundId }, orderBy: 'batchId', orderDir: 'desc', limit: 100 })
  const myFills = useMemo(
    () =>
      fills.records
        .filter((r) => r.data.userId === userId)
        .map((r) => ({ ...r.data, id: r.recordId }))
        .sort((a, b) => b.batchId - a.batchId || a.id.localeCompare(b.id)),
    [fills.records, userId],
  )

  const portfolios = useQuery<PortfolioRecord>('portfolios', { where: { roundId }, limit: 500 })
  const portfolioData = useMemo(() => portfolios.records.map((r) => r.data), [portfolios.records])
  const mine = useMemo(() => portfolioData.find((p) => p.userId === userId) ?? null, [portfolioData, userId])
  const view = useMemo(() => portfolioView(mine, last, openOrders), [mine, last, openOrders])
  const freeShares = useMemo(() => {
    const held = mine ? readHoldings(mine.holdings)[ticker] : 0
    return Math.max(0, held - reservedBy(openOrders).shares[ticker])
  }, [mine, openOrders, ticker])

  const live = stream.connected && stream.phase === 'live'
  const blockedReason = !stream.synced
    ? 'Connecting to the exchange.'
    : !stream.connected
      ? 'Lost the market feed. Reconnecting.'
      : stream.phase !== 'live'
        ? 'Trading is closed for the results break.'
        : !ready
          ? 'Connecting to your account.'
          : null

  const current = useCurrentRound()
  const finished = current.round && current.round.recordId === stream.roundId ? current.round.data : null
  const [hiddenFor, setHiddenFor] = useState<string | null>(null)
  const showBreak = stream.synced && stream.phase === 'break' && hiddenFor !== stream.roundId
  const hideBreak = useCallback(() => setHiddenFor(stream.roundId), [stream.roundId])

  const streamStatus = !stream.synced ? 'loading' : !stream.connected ? 'error' : 'ready'
  const queryStatus = (q: { status: 'loading' | 'ready' | 'error' }) => (stream.synced ? q.status : 'loading')

  return (
    <div
      data-testid="trade-terminal"
      data-phase={stream.phase ?? 'unknown'}
      data-round-id={stream.roundId}
      data-connected={stream.connected}
      className="relative mx-auto flex max-w-[1600px] flex-col gap-3 p-3"
    >
      <h1 className="sr-only">Trading terminal</h1>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <TickerTabs active={ticker} onChange={setTicker} last={last} open={open} />
        <BatchClock
          connected={stream.connected}
          synced={stream.synced}
          phase={stream.phase}
          phaseEndsAt={stream.phaseEndsAt}
          batchId={stream.batchId}
          nextBatchAt={stream.nextBatchAt}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_240px_320px]">
        <OrderTicket
          ticker={ticker}
          lastCents={last[ticker]}
          blockedReason={blockedReason}
          freeCashCents={view.freeCashCents}
          freeShares={freeShares}
          className="lg:order-3"
        />
        <PriceChart
          ticker={ticker}
          roundId={stream.roundId}
          prints={stream.prints}
          lastCents={last[ticker]}
          openCents={open[ticker]}
          className="lg:order-1"
        />
        <DepthLadder
          ticker={ticker}
          depth={stream.depth[ticker]}
          lastCents={last[ticker]}
          status={streamStatus === 'ready' && stream.phase === 'break' ? 'closed' : streamStatus}
          className="max-h-[420px] lg:order-2 lg:max-h-none"
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <Positions
          view={view}
          status={queryStatus(portfolios)}
          error={portfolios.error}
          active={ticker}
          className="max-h-[300px]"
        />
        <OpenOrders
          orders={openOrders}
          status={queryStatus(orders)}
          error={orders.error}
          canCancel={live && ready}
          className="max-h-[300px]"
        />
        <MyFills fills={myFills} status={queryStatus(fills)} error={fills.error} className="max-h-[300px]" />
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Leaderboard
          portfolios={portfolioData}
          last={last}
          currentUserId={userId}
          status={queryStatus(portfolios)}
          error={portfolios.error}
          className="max-h-[360px]"
        />
        <Tape roundId={stream.synced ? roundId : undefined} className="max-h-[360px]" />
        <NewsFeed roundId={stream.synced ? roundId : undefined} className="max-h-[360px]" />
        <OnlineTraders className="max-h-[360px]" />
      </div>

      {showBreak && (
        <RoundBreakOverlay round={finished} phaseEndsAt={stream.phaseEndsAt} currentUserId={userId} onHide={hideBreak} />
      )}
    </div>
  )
}

