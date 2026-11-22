import type { Ticker } from '../../shared/contracts.js'

/** The three fictional companies. Mirrors the `tickers` collection seed. */
export const COMPANIES: Record<Ticker, { name: string; sector: string }> = {
  ORBT: { name: 'Orbital Compute', sector: 'tech' },
  CURA: { name: 'Curaline Bio', sector: 'biotech' },
  VOLT: { name: 'Voltgrid Energy', sector: 'energy' },
}
