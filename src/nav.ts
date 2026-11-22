/**
 * Navigation config: one entry per header link. Routes come from the files
 * in src/pages/ (generouted); this only controls what the header shows.
 */

import type { Role } from './constants'

export interface NavItem {
  path: string
  label: string
  roles?: Role[]
  devOnly?: boolean
}

export const nav: NavItem[] = [
  // /trade is ui-trading's terminal (src/pages/(app)/(protected)/trade.tsx).
  { path: '/trade', label: 'Trade' },
  { path: '/rounds', label: 'Rounds' },
]
