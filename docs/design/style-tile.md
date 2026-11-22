# tickfair: style tile

The six commitments from `/design/style-tile`. The landing page and the app
share all of them. Tokens live in `src/theme/tokens.css`.

| Token | Commitment |
|-------|------------|
| **Color** | Graphite-black dominant, warm off-white text, departure-board amber as the single accent (CTAs, sweep, focus only). Up is a mint green and down is a coral red, used only for price direction. Muted everywhere except the accent. |
| **Type** | IBM Plex Sans for headings and body, plus IBM Plex Mono for every number. It's one engineered family, so the page reads as one instrument, and mono keeps price columns aligned digit for digit. Both are self-hosted (OFL) in `src/theme/fonts/`. |
| **Theme** | Dark. A trading floor is a board of lit numbers, and light mode would flatten the up and down colors. |
| **Art direction** | Modern minimalism with a dense, instrument-panel layout: flat 1 px borders, 4 px radius, no gradients, no glass, and no shadows beyond the scaffold's faint card shadow. |
| **Motion** | Mechanical and technical: linear sweeps, instant snaps, and no springs. The only looping motion is the batch sweep, and it stops under `prefers-reduced-motion`. |
| **Voice** | Second person ("you"), never "we"; sentences of 12 words or fewer; no exclamation points. |

## Palette

| Token | Value | Use |
|-------|-------|-----|
| `background` | `#0c0e10` | Page |
| `card` | `#13161a` | Panels |
| `popover` | `#171b20` | Menus |
| `secondary` / `muted` | `#1b1f24` | Fills, skeletons |
| `accent` | `#22272d` | Hover rows |
| `border` | `#262b31` | Lines |
| `foreground` | `#e6e4dc` | Text |
| `muted-foreground` | `#9aa0a6` | Labels (7.3:1 on background) |
| `primary` | `#f2b33d` | Amber accent; text on it is `#14110a` |
| `up` | `#3ccf8e` | Rising price, buy side |
| `down` | `#f0605a` | Falling price, sell side |
| `up-muted` / `down-muted` | `#12291f` / `#2e1716` | Depth bars, row tints |

## Up and down without color

`src/theme/Delta.tsx` renders every change with a sign and an arrow:
`▲ +1.25` / `▼ −0.40` / `· 0.00`. Leaderboard P&L, tape ticks, and (later)
the depth ladder all use it, so the board stays readable for color-blind
players and in grayscale screenshots.

## Derived choices

- **Spacing:** an 8 px grid; dense tables use 4 px vertical padding.
- **Icons:** `lucide-react` outline only.
- **Numbers:** `font-mono tabular-nums`, right-aligned, with money formatted
  by `src/theme/format.ts`.
