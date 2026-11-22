# Report: ui-trading (wave 2)

Built and verified against the real, merged exchange-runtime engine. No mocks, no fake streams. Port 5187 throughout. No paid LLM calls (`NEWS_LLM_IN_DEV` was never set; the log shows `[news] skipped llm_disabled_in_dev`).

## 1. Built and verified

All commands were run by me on the final code commit `462f1a4`.

| Item | Proof | Result |
|------|-------|--------|
| Typecheck | `npm run type-check` (`tsc --noEmit`) | exit 0, no output |
| Lint | `npm run lint` (`eslint .`) | exit 0, no output |
| Unit | `npx deepspace test run unit --port 5187` | exit 0, `Test Files 17 passed (17)`, `Tests 257 passed (257)` (38 are new: `src/components/trading/logic.test.ts`, `views.test.tsx`) |
| e2e | `npx deepspace test run e2e --port 5187` (final two runs, back to back) | exit 0 both times: `26 passed`, `1 skipped` (the skip is the opt-in screenshot test) |
| Build | `npm run build` | exit 0 |
| `useExchangeStream()` connects like the SDK hooks: a JWT from `getAuthToken()` in `?token=`, nothing else identifying in the URL, anonymous when signed out. It handles `ex.snapshot`, `ex.batch`, and `ex.phase`. A fresh snapshot replaces all state, deltas before the first snapshot are ignored, and it reconnects with jittered backoff (0.5 s doubling to a 10 s cap). | `streamReducer` and `backoffMs` unit tests; e2e checks `data-connected="true"` and the round id on the real socket | pass |
| `/trade` is gated | smoke `'/trade is gated when signed out'`: shows the gate, with no terminal, ticket, or ladder in the DOM | pass |
| Signed in, it renders real engine data | smoke `'ticket, ladder, chart, and leaderboard render with real engine data'`: live prices in all 3 tabs, the chart price, book levels during a live round, ticket enabled when live and disabled in a break, leaderboard loaded, all panels present, no console errors | pass |
| A buys and B sells into it, through the UI | collab `'A buys, B sells into it…'`: B buys first (long-only), then A bids at +4% while B offers at −4%. Each side's fills panel shows the fill for its own `orderId`. | pass |
| Both see the print in Tape | same test: a tape row with ORBT at A's fill price is shown on both pages | pass |
| Both leaderboards reflect the new equity | same test: both pages list both traders, and A's equity text is equal on A's and B's pages (`toPass`); A's positions show ORBT | pass |
| B can't see A's open order | same test: A rests a buy at −8%, and its `orderId` appears in A's open orders but not in `b.page.content()`. A then cancels it through the UI and the row disappears (this also covers cancel). | pass |
| Presence ticker | collab `'presence: B sees A move to CURA'`: B's OnlineTraders shows A on ORBT, then on CURA after A switches tabs | pass (but see §2: flaky in parallel) |
| Phase-safe tests (LESSONS 25) | `waitForLiveRound` waits out a break or a round with less than 45 s left (up to 200 s), and every trading test rechecks `roundId` and `phase` at the end | in place in both trading tests |
| Every panel has loading, empty, and error states | `views.test.tsx`: depth ladder (loading, closed, empty, error), open orders, fills, positions, chart, batch clock states, round-break overlay (tallying, no humans, bots filtered out) | pass |
| Reserve math and reject text | `ticketReserve` matches the engine: limit = qty × limit; market buy = band top via engine-core `priceBand`, rounding inward; sell = shares. Free cash = `cashCents` minus reserved open buys (LESSONS 23). All 16 `RejectCode`s map to a short sentence with no `!`. | unit pass |
| Screenshots at 1280 and 390 during a live round, with real engine data | `TRADE_SCREENSHOTS_DIR=… npx deepspace test run e2e --port 5187 --grep screenshots` → `1 passed` | `orchestrations/files/reports/ui-trading/trade-1280.png`, `trade-1280-full.png`, `trade-390.png` |

What the terminal contains:
- Ticker tabs, which also set the presence ticker through `useFloorPresence().setTicker` (no second presence socket).
- An SVG price chart: `tape` history merged with live prints, one point per batch.
- A depth ladder with tinted quantity bars and the spread. A crossed book between batches says "crosses next batch".
- The order ticket: buy/sell, limit/market, qty, price prefilled from the last trade, the band, what the order reserves, free cash or free shares, and inline reject messages. It is disabled until the socket is synced and connected, the round is live, and `useMutations('orders').ready`.
- Open orders with cancel, my fills, and positions with P&L (my `portfolios` record × live `last`).
- The batch sweep with the next-batch countdown (rAF on refs; under reduced motion the bar stays still) and the round countdown.
- `Leaderboard` (fed the live `last`), `Tape`, `NewsFeed`, and `OnlineTraders`.
- The round-break overlay with final standings and a "View the board" button that hides it.
- The fairness note next to the ticket.

## 2. Built but unverified

- **Presence tests are flaky when Playwright runs spec files in parallel. The cause is outside my files.** Over 6 parallel runs, a presence assertion failed 2 times: once my collab presence test, and once ui-shell's `/home` presence test in `smoke.spec.ts`. Run serially (`DEEPSPACE_PORT=5187 npx playwright test -c tests/playwright.config.ts --workers=1`), the presence tests passed 3 of 3 alone and the full suite passed (`26 passed, 1 skipped`).
  - Cause: `smoke.spec.ts` and `collab.spec.ts` run at the same time in separate workers, signed in as the same two accounts. When one test closes its context, the SDK client handles `PRESENCE_LEAVE` by removing the peer by `userId` (`setPeers(prev => prev.filter(x => x.userId !== p.userId))`). The user then disappears from everyone's floor list, even though their other session is still connected.
  - The same thing happens to a real user who closes one of two tabs. I did not paper over it in the tests. See §5.
- **The round-break overlay with real standings was not e2e-tested.** The default break is 2 minutes, and I didn't make the tests depend on the round phase. Its states are covered by `views.test.tsx`. I saw it only as code paths, not in a live break.
- **Reconnect after a dropped socket** was tested in the reducer (a close keeps the data and marks it disconnected; the next snapshot replaces everything), but not by killing a socket in e2e.

## 3. Not built or cut

- The fairness "audit" drawer per print (PLAN §8 nice-to-have). Cut for time.
- No chart library. It is plain SVG, as the task allows without approval. It has no axes beyond the high/low labels.
- Market sells show "best in batch" and reserve shares. I don't show the band-low price they are stored at.

## 4. Files changed

Everything is inside my ownership list, plus the report folder:
- `src/pages/(app)/(protected)/trade.tsx`
- `src/hooks/useExchangeStream.ts`
- `src/components/trading/**`: `BatchClock`, `DepthLadder`, `MyOrders`, `OrderTicket`, `PriceChart`, `RoundBreak`, `TickerTabs`, `api.ts`, `logic.ts`, `logic.test.ts`, `views.test.tsx`
- `tests/collab.spec.ts`, which keeps the scaffold's identity test and adds the trade, presence, and opt-in screenshot tests
- `tests/smoke.spec.ts`: all of ui-shell's tests are kept, the `/trade` 404-skip was replaced with a real gate check, and one signed-in terminal test was added
- `orchestrations/files/reports/ui-trading.md` and `orchestrations/files/reports/ui-trading/*.png`

The client imports engine-core's `priceBand` read-only, so the ticket's band and market reserve match the engine exactly. I edited no engine file.

## 5. Requests for the director

1. **DIRECTOR QUESTION: presence across sessions of the same user.** Pick one:
   - (a) Add `workers: 1` (or `fullyParallel: false, workers: 1`) to `tests/playwright.config.ts` so specs sharing accounts never overlap. This fixes the flake. The suite takes about 50 s serially.
   - (b) Also, or instead, fix the product behavior. Count connections per user in `FloorPresence`/`mergeOnline` (ui-shell), or ask the SDK to send `PRESENCE_LEAVE` only when a user's last connection closes. Today, closing a second tab hides the user from the floor.

   I recommend (a) now and (b) as a tracked fix.
2. **Landing anchor.** The fairness note links to `/#how-it-works`, but the "How a batch auction works" section in `src/pages/index.tsx` (owned by ui-shell) has no `id`. Please add `id="how-it-works"` to that `<section>`. Until then the link opens the landing page at the top.
3. No contract changes, no new dependencies, no `src/actions/index.ts` registrations needed.

## 6. Lessons

- **`ex.phase` can arrive before `ex.snapshot`** on the first connect (the room's `ensureAwake` broadcasts first). The client must ignore deltas until it has a snapshot.
- **The book can be crossed between batches.** Resting orders wait for the next clear, so `depth` can show the best bid above the best ask. Don't show a negative spread.
- **Order and fill rows don't arrive in the action response.** `placeOrder` returns `{ orderId, batchId }`, and the rows show up about 1 s later through the mirror. Key test assertions on `data-order-id`.
- **Long-only rules matter in tests:** a trader must buy before selling (`insufficient_shares` otherwise).
- **`deepspace test run` needs the port free.** Stopping `dev start` from a background task can leave its child process listening. Use `npx deepspace dev kill --port <port>` (only for a server you started).
- **Specs that share test accounts must not run in parallel** while presence drops users by `userId` (see §5).

## 7. Branch and commit

- Branch: `agent/ui-trading`
- Final code commit: `462f1a4`. This report is committed on top of it.
