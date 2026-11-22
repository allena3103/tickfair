/**
 * Theme catalog. tickfair has one theme, "floor"; its colors live in
 * src/theme/tokens.css and are the app default, so the page renders the same
 * whatever data-theme index.html sets. This file is metadata only.
 */

export const THEMES = [
  {
    id: 'floor',
    label: 'Floor',
    description: 'Dark trading board: graphite, warm white, one amber accent.',
  },
] as const

export type ThemeId = (typeof THEMES)[number]['id']

/** The active theme id. Only one theme exists, so this is always "floor". */
export function getActiveTheme(): ThemeId {
  return 'floor'
}

/** Look up a theme entry by id, or fall back to the first theme. */
export function getTheme(id: string) {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}
