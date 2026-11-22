# tickfair: design direction

The six-prompt brief from `/design/direction`. The same text sits at the top of
`src/pages/index.tsx` as the Design Direction block.

## The brief

1. **Product.** A shared stock-trading floor where players trade three made-up
   stocks for 15-minute rounds, and every order sent in the same second fills
   at one fair price.

2. **Emotion.** The half-second before the departures board flips: you've
   placed your bet, and the whole room finds out at once.

3. **Visual metaphor.** A Swiss railway station clock at night above a
   split-flap departures board. The red second hand sweeps, pauses at twelve,
   and every row on the board flips together.

4. **References from outside finance.**
   - The SBB station clock (Hans Hilfiker, 1944), whose second hand stops at
     twelve so every clock on the network starts the minute together. This is
     our batch boundary.
   - Solari split-flap departure boards: amber characters on black, all rows
     changing at once, and dense rows that stay readable from across a hall.
   - Braun ET66 calculator (Dieter Rams): a dark body with one warm accent key,
     where every number is set in a strict grid.

5. **Signature element.** The **batch sweep**: a one-second sweep bar that fills,
   snaps at the edge, and stamps a single clearing price. It appears in the
   landing hero, in the "how it works" diagram, and later as the next-batch
   countdown in the terminal.

6. **Hero visual.** Order chips drift into an open one-second window while the
   sweep bar fills. At the edge the window shuts, the chips collapse onto one
   price line, and a print stamps onto a short tape. The cycle loops every
   three seconds, and with reduced motion it shows the stamped state only.

**Sentence test.** "Orders in the same second fill at one price, like a
station board that flips every row at once." No other product category fits
that sentence, so the brief passes.

## How the brief becomes UI

- **Density.** The board is dense, never cramped. Rows are 28–32 px, set in
  tabular mono, in a strict column grid.
- **One warm accent.** Departure-board amber marks the primary action, the
  sweep, and focus. Everything else is graphite neutral.
- **Up and down never rely on color alone.** Each delta carries a sign and an
  arrow (`▲ +1.25` / `▼ −0.40`), and color only reinforces it.
- **Sharp shapes.** Radius is 4 px, borders are flat 1 px lines, and there are
  no glows, gradients, or glass.

## What we borrow from real trading UIs

Screenshots are in `docs/design/refs/` (captured 2026-11-21).

| Reference | Borrow | Leave |
|-----------|--------|-------|
| `binance-spot.png` (Binance spot) | A ladder of mono prices with a tinted depth bar behind the quantity; the market-trades list with price colored by direction and right-aligned time; a thin ticker strip in the footer. | Its yellow-on-everything branding, menu sprawl, and promo badges. |
| `kraken-pro.png` (Kraken Pro) | Generous black space, small uppercase labels over large mono values ("LAST PRICE", "24H CHANGE"), a buy/sell segmented toggle, and one primary action that says what it does ("Sign up to trade"). | The volume histogram, multi-chart chrome, and tab clutter. |
| `tradingview-chart.png` (TradingView) | Watchlist rows with symbol, last, change, and change % in fixed columns; a symbol detail block with a huge price and a signed change beside it. | The light theme, tool rails, and floating promo popovers. |

A note on a fourth reference: Coinbase Advanced blocked the automated capture
behind a bot check, so Kraken Pro replaced it.
