/**
 * engine-core: pure, synchronous batch-auction clearing and account math.
 * No I/O, no clocks, no randomness. Same input, same output.
 */
export type { Account, BookOrder, ClearResult, Fill } from './types'
export { batchSeed } from './seed'
export { clearBatch, clearingPrice } from './clear'
export {
  MAX_ORDER_QTY,
  checkAndReserve,
  emptyAccount,
  marketLimit,
  priceBand,
  releaseOrder,
  settleFill,
} from './accounts'
