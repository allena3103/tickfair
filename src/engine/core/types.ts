import type { Side, Ticker } from '../../shared/contracts'

/** One resting or incoming order as the engine sees it. `remaining` is the unfilled quantity. */
export interface BookOrder {
  orderId: string
  traderId: string
  ticker: Ticker
  side: Side
  limitCents: number
  remaining: number
  /** The batch the order arrived in. Earlier batches have priority at the same price. */
  batchId: number
}

/** One execution. `batchId` is the batch being cleared, not the order's arrival batch. */
export interface Fill {
  orderId: string
  traderId: string
  ticker: Ticker
  side: Side
  qty: number
  priceCents: number
  batchId: number
}

export interface ClearResult {
  ticker: Ticker
  batchId: number
  /** null when the book does not cross. */
  clearCents: number | null
  volume: number
  seed: string
  fills: Fill[]
}

/**
 * A trader's money in the engine.
 *
 * - `cashCents` is FREE cash. Cash held for open buy orders sits in `reservedCents`,
 *   so the trader's total cash is `cashCents + reservedCents`.
 * - `holdings[t].qty` is ALL shares owned. `reservedQty` is the part of `qty`
 *   held for open sell orders, so free shares are `qty - reservedQty`.
 *
 * Invariants: cashCents >= 0, reservedCents >= 0, qty >= reservedQty >= 0.
 */
export interface Account {
  cashCents: number
  reservedCents: number
  holdings: Record<Ticker, { qty: number; reservedQty: number }>
}
