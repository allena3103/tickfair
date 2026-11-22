import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import type { Ticker } from '../../shared/contracts'

export function sha256Hex(text: string): string {
  return bytesToHex(sha256(utf8ToBytes(text)))
}

/**
 * Public, recomputable seed for one batch of one ticker:
 * hex SHA-256 of `${roundId}|${ticker}|${batchId}|${sorted orderIds joined by ','}`.
 * Ids are sorted with the default JS string order (UTF-16 code units).
 */
export function batchSeed(roundId: string, ticker: Ticker, batchId: number, orderIds: string[]): string {
  const ids = [...orderIds].sort()
  return sha256Hex(`${roundId}|${ticker}|${batchId}|${ids.join(',')}`)
}

/** Leftover-share tiebreak key: the lowest `sha256(seed + orderId)` (hex, compared as strings) wins. */
export function tiebreakKey(seed: string, orderId: string): string {
  return sha256Hex(seed + orderId)
}
