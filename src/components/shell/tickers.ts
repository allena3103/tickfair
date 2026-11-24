import { SIM_PLAYER_PREFIX, type Ticker } from '@/shared/contracts'

/**
 * Display names for the three fictional tickers. The `tickers` collection
 * carries the same names at runtime; this copy exists for the static landing
 * page (no data layer) and as a fallback while records load.
 */
export const TICKER_INFO: Record<Ticker, { name: string; sector: string }> = {
  ORBT: { name: 'Orbital Compute', sector: 'Tech' },
  CURA: { name: 'Curaline Bio', sector: 'Biotech' },
  VOLT: { name: 'Voltgrid Energy', sector: 'Energy' },
}

/** Bots trade through the same rules but never appear in standings. */
export function isBotId(userId: string): boolean {
  return userId.startsWith('bot:')
}

/** Sim players are the only bots shown on the live leaderboard, with a BOT tag. */
export function isSimPlayerId(userId: string): boolean {
  return userId.startsWith(SIM_PLAYER_PREFIX)
}
