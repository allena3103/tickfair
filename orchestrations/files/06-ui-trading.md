# Task 06: ui-trading (Wave 2)

- Worktree: `C:/DeepSpace-project-ui-trading`, branch `agent/ui-trading` (from `agent/exchange` after wave 1 merged), port **5187**.
- Read first: `BRIEF.md`, `PLAN.md` §8, `docs/design/**` from ui-shell (follow it; don't restyle), `src/components/feed/**`.

## Owns

`src/pages/(app)/(protected)/trade.tsx`, `src/components/trading/**`, `src/hooks/useExchangeStream.ts`, `tests/collab.spec.ts`, `tests/smoke.spec.ts` (inherits from ui-shell; keep its tests).

## Out of scope

Engine behavior, schemas, the feed components (reuse them; ask the director for changes), and the landing page.

## Timing

You start alongside exchange-runtime and build against the frozen contracts. **When the director says exchange-runtime is merged, rebase onto `agent/exchange`** and do all verification against the real engine. Don't build mock streams or fake data to fill the screen.

## Steps

1. **`useExchangeStream()`.** Connects to `/ws/exchange/exchange:${APP_ID}` the same way the SDK hooks connect (JWT from the SDK; never put identity in the URL). It:
   - handles `ex.snapshot`, `ex.batch`, and `ex.phase`;
   - exposes `{ connected, phase, phaseEndsAt, batchId, nextBatchAt, last, depth, prints }`;
   - reconnects with backoff and treats a fresh snapshot as truth.
2. **`/trade` page**, gated under `(protected)`:
   - ticker tabs (setting the presence `ticker`);
   - a price chart (tape history from `useQuery('tape')` plus live prints; a lightweight chart lib only with director approval, otherwise SVG);
   - a depth ladder;
   - an order ticket (buy/sell, limit/market, qty, price):
     - disabled until `ready`, the round is live, and the socket is connected;
     - shows the cash or shares that will be reserved;
     - calls `placeOrder` and maps each `RejectCode` to plain-language inline errors;
   - my open orders, `useQuery('orders')` with status open or partial, with cancel;
   - my fills;
   - positions and P&L (my `portfolios` record × `last`);
   - batch countdown (to `nextBatchAt`) and round countdown;
   - feed components from ui-shell: `NewsFeed`, `Tape`, `Leaderboard` (fed `last`), `OnlineTraders`;
   - a round-break overlay showing final standings.
3. **Layout.** Every panel has loading, empty, and error states. It must work at 1280 px and remain usable at 390 px (a stacked layout is fine).
4. **Fairness hint.** A short "Orders in the same 1-second batch are treated as simultaneous" note next to the ticket, linking to the landing page explanation.

## Tests

- **`tests/smoke.spec.ts`:** `/trade` signed out → overlay, and protected content absent. Signed in → ticket, ladder, and leaderboard render with real data from the engine.
- **`tests/collab.spec.ts`** (`users(2)`, plus a third account if available):
  - A places a buy and B a crossing sell through the UI. Both see the print in `Tape`. Both leaderboards reflect new equity. A's fills panel shows the fill. B can't see A's open order anywhere in the DOM.
  - The presence ticker: A switches to `CURA`, and B's `OnlineTraders` shows A on `CURA`.
- Screenshots of `/trade` at 1280 and 390 during a live round.

## Acceptance

- [ ] `test run e2e --port 5187` passes after rebasing onto the merged runtime.
- [ ] The screenshots show real engine data.
- [ ] Final report per `BRIEF.md`.
