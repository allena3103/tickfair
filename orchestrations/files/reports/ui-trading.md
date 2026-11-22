# Report: ui-trading (wave 2), fresh-review fixes

**Fresh reviewer FAIL fixed, on code commit `07f8313`.** Every check was rerun by me on that commit.

| Item | Fix | Proof |
|------|-----|-------|
| **F1** The PERF test could pass vacuously. | `tests/smoke.spec.ts`: before the window opens, the test asserts that each fingerprint group (chart tape, orders, fills, portfolios) was subscribed at least once. During the window it records received `core.record_change` frames for `tape`, and asserts at least one arrived. It still asserts at least 20 batches ran. | e2e passes with chart tape 0, orders 0, fills 0, portfolios 0 (`feedTape` 24). The earlier negative check (old chart query → 25 repeats, test failed) still applies. The counting is unchanged; only guards were added. |
| **F4** The window could straddle a round end. | It now waits (up to 240 s) for a live phase with more than 50 s left, which covers the 3 s settle plus the 30 s window. It then records the round id and asserts the same round id after the window. | Same e2e run. |
| **F2** (resolved by the reviewer) | Added the requested unit test: `chartPoints` gets 350 batches in scrambled order, split across tape and prints, and returns exactly the newest 300 in strictly ascending batch (time) order: first batch 51, last batch 350. | Unit pass. |
| **F3** Response-time balance capture | **Known untested path.** The ref that `OrderTicket` reads when a reject arrives has no component test. A cheap test isn't practical: the unit setup renders to static markup with no DOM or events, and the e2e setup can't reliably land a fill between send and response. The rule it feeds (`rejectIsStale`) is fully unit-tested. | — |

| Check | Command | Result |
|-------|---------|--------|
| Typecheck | `npm run type-check` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Unit | `npx deepspace test run unit --port 5187` | exit 0, `Test Files 17 passed (17)`, `Tests 276 passed (276)` |
| e2e | `npx deepspace test run e2e --port 5187` | exit 0, `32 passed`, `1 skipped` (opt-in screenshots), 1.5 min. PERF logged `{"chartTape":0,"orders":0,"fills":0,"portfolios":0,"feedTape":24}` |

The ui-shell `Tape` request (re-subscribes about once per batch) still stands.

Files changed: `tests/smoke.spec.ts`, `src/components/trading/logic.test.ts`. Both are in my ownership list.

---

## Reviewer fixes on evaluator run 3

**Reviewer FAIL fixed, on code commit `e5938cc`.** Every check was rerun by me on that commit.

| Finding | Fix | Test |
|---------|-----|------|
| **F1** `rejectIsStale` cleared any reject on any balance change in either direction. | `logic.ts`: the ticket now stores the reject `code` and `ticker` with the balances (`RejectSnapshot`). A reject is stale only for `insufficient_cash` when free cash **rose**, or `insufficient_shares` when free shares of the **same ticker** rose. Every other code (`outside_band`, `too_many_open`, `self_cross`, `rate_limited`, `round_closed`, transport errors) is never cleared by balance changes, only by the next edit or send. | Unit `rejectIsStale (BUG-1)`, 3 cases: cash rise clears `insufficient_cash`, but a cash fall, a shares change, or no change keeps it; a shares rise clears `insufficient_shares`, but a fall, a cash-only change, or another ticker keeps it; 7 other codes are kept under both rises and falls. |
| **F2** The balances stored with a reject came from the submit-time closure. | `OrderTicket.tsx`: a ref holds `{ ticker, freeCashCents, freeShares }` and is updated by an effect after each render. The response handler spreads `free.current` into the error, so the reject is judged against the balances at response time. A fill that lands while the order is in flight no longer hides the reject before it is shown. | Covered by the F1 rule tests, plus typecheck and lint (`react-hooks` rules pass with the ref updated in an effect, not during render). |
| **F3** The PERF test counted per `subscriptionId`, so a re-subscribe under a fresh id would go uncounted. | `tests/smoke.spec.ts`: frames are counted per query fingerprint, `JSON.stringify([collection, where, orderBy, orderDir, limit])`. The SDK de-duplicates identical query keys, so one fingerprint is one live query. A repeat under any id counts. | **Negative check, rerun with the new counting:** with the old chart query (`orderBy: 'at', limit: 300`) put back, chart tape was **25** in 30 s and the test failed (exit 1). With the fix: chart tape 0, orders 0, fills 0, portfolios 0. |

| Check | Command | Result |
|-------|---------|--------|
| Typecheck | `npm run type-check` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Unit | `npx deepspace test run unit --port 5187` | exit 0, `Test Files 17 passed (17)`, `Tests 275 passed (275)` |
| e2e | `npx deepspace test run e2e --port 5187` | exit 0, `32 passed`, `1 skipped` (opt-in screenshots), 1.6 min. PERF logged `{"chartTape":0,"orders":0,"fills":0,"portfolios":0,"feedTape":23}` |

The ui-shell `Tape` request below still stands (`feedTape` 23 in 30 s).

Files changed: `src/components/trading/logic.ts`, `logic.test.ts`, `OrderTicket.tsx`, `tests/smoke.spec.ts`. All are in my ownership list.

---

## Evaluator run 3 fixes

**Evaluator run 3 fixes, on code commit `3ba2718`,** rebased onto `agent/exchange` at `e6cc3e4` (clean). Every check was rerun by me on that commit.

| Item | Fix | Test |
|------|-----|------|
| **BUG-1** A stale reject ("You do not have enough free shares to sell.") stayed on the ticket after free shares or cash changed. | `OrderTicket.tsx`: a reject is stored with the free cash and free shares it was judged against. It is shown only while both are unchanged (`rejectIsStale` in `logic.ts`). This is derived on each render, so cancelling the resting order that caused it, or a fill, removes the message at once. | Unit: `rejectIsStale (BUG-1)`, where unchanged free cash and shares keep the reject, and a change in either drops it. |
| **BUG-3** The round-break overlay rounded P&L to whole dollars. | `RoundBreak.tsx`: P&L now shows cents. Equity stays whole dollars, which matches the current `Leaderboard` and `/rounds`: both show equity in whole dollars and P&L in cents. | Unit (`views.test.tsx`): standings with +$123.45 render `+$123.45` and equity `$100,123`. |
| **PERF** One `/trade` page re-sent `core.subscribe` for tape about 1,335 times in about 12 minutes, with the same subscription ids. | The cause was not options identity: the SDK's `useQuery` keys on `JSON.stringify(options)`. In `RecordSocket.handleMessage`, `RECORD_CHANGE` re-sends `core.subscribe` (same subscription id) for **every query on that collection with `orderBy` or `limit`**, while plain `where` queries are patched in place. Tape gets new rows every batch. Fix: my queries on busy collections now use `where` only, and I sort and cap on the client. Each set is bounded per round. <br>• `PriceChart`: tape `{ roundId, ticker }` (at most about 900 rows per round; `chartPoints` keeps the newest 300). <br>• `trade.tsx`: orders `{ roundId, status, userId }` (at most 20 live), fills `{ roundId, userId }` (sorted, capped to 100 for display), portfolios `{ roundId }` (human traders only). <br>• `rounds` keeps `orderBy/limit 5`: rounds change twice per round, and without a limit that query would grow without bound. | New e2e in `tests/smoke.spec.ts`: `'terminal queries are not re-subscribed on every print (PERF)'`. In a live round, it counts `core.subscribe` frames sent per subscription over 30 s (and asserts at least 20 batches ran). **With the fix:** chart tape 0, orders 0, fills 0, portfolios 0 (each must be ≤ 1, allowing one reconnect). **Negative check:** with the old chart query (`orderBy: 'at', limit: 300`) put back, chart tape was **26** in 30 s and the test failed (exit 1). |

| Check | Command | Result |
|-------|---------|--------|
| Typecheck | `npm run type-check` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Unit | `npx deepspace test run unit --port 5187` | exit 0, `Test Files 17 passed (17)`, `Tests 274 passed (274)` |
| e2e | `npx deepspace test run e2e --port 5187` | exit 0, `32 passed`, `1 skipped` (opt-in screenshots), 1.7 min. The PERF test logged `{"chartTape":0,"orders":0,"fills":0,"portfolios":0,"feedTape":23}` |

**Request for the director (outside my files):** ui-shell's `Tape` (`src/components/feed/Tape.tsx`, `useQuery('tape', { where, orderBy: 'at', orderDir: 'desc', limit })`) still re-sends `core.subscribe` about once per batch: `feedTape` was 23–28 per 30 s in my runs, on both `/trade` and `/home`. That is the rest of the evaluator's count. The same fix applies: query `where: { roundId[, ticker] }` with no `orderBy`/`limit`, then sort by `at` and slice on the client. `NewsFeed` uses the same pattern, but news changes rarely. My PERF test already reports `feedTape`, so it can confirm that fix.

Files changed: `src/components/trading/OrderTicket.tsx`, `RoundBreak.tsx`, `PriceChart.tsx`, `logic.ts`, `logic.test.ts`, `views.test.tsx`, `src/pages/(app)/(protected)/trade.tsx`, `tests/smoke.spec.ts`. All are in my ownership list.

---

## Evaluator run 2 fix

**E2-1, on code commit `5b5503a`,** rebased onto `agent/exchange` at `634b864` (clean). Every check was rerun by me on that commit.

| Bug | Fix | Test |
|-----|-----|------|
| **E2-1** A cancel that lost the race to a fill showed "That order already filled or was cancelled." and kept showing it long after the order left the list. | `MyOrders.tsx`: a cancel failure is now stored with its order id (`{ orderId, message }`). The panel shows it only while that order is still in Open orders (`cancelFailureToShow` in `logic.ts`). This is derived on each render, so it needs no timer or effect: the message disappears in the same render that drops the filled order. A failure on an order that is still listed (for example a network error) stays visible until that order leaves or the next cancel attempt. | Unit: `cancelFailureToShow (E2-1)`: shown while the order is listed, null once it leaves (including an empty list), and null without a failure. |

| Check | Command | Result |
|-------|---------|--------|
| Typecheck | `npm run type-check` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Unit | `npx deepspace test run unit --port 5187` | exit 0, `Test Files 17 passed (17)`, `Tests 271 passed (271)` |
| e2e | `npx deepspace test run e2e --port 5187` | exit 0, `31 passed`, `1 skipped` (opt-in screenshots), 54.3 s |

I didn't add an e2e test for the race itself: making a fill and a cancel land in the same batch on purpose would depend on bot timing. The unit test covers the rule that clears the message.

Files changed: `src/components/trading/MyOrders.tsx`, `src/components/trading/logic.ts`, `src/components/trading/logic.test.ts`. All are in my ownership list. No open requests for the director.

---

## Evaluator fixes (run 1)

**Evaluator fixes, on code commit `123426e`,** rebased onto `agent/exchange` at `5d96efe`. The rebase was clean; my earlier commits were already merged there. Every check was rerun by me on that commit.

| Bug | Fix | Test |
|-----|-----|------|
| **BUG-3** An old ticket result (for example the server's `invalid_qty` text "Enter a whole number of shares, up to 100,000.") stayed visible after editing the ticket. | `OrderTicket.tsx`: every input (side, type, quantity, price) goes through `edited(setter)`, which also resets the last result to idle, unless an order is mid-send. Both the error and the "Order in for batch #…" line clear on any edit. A ticker switch already reset it. | New e2e in `tests/smoke.spec.ts`: `'an old ticket error clears as soon as you edit the ticket (BUG-3)'`. On the real server it sends 200,000 shares (rejected as `invalid_qty` before reaching the room, so no order is created), checks the exact error text, then checks that each kind of edit (quantity, price, side, type) removes it. It waits for a live round first (LESSONS 25). **Negative check:** with the reset line removed, this test fails (`toHaveCount` 0, exit 1); with the fix it passes (exit 0). |
| **BUG-5a** The chart meta read "1 batches". | New `plural(n, one, many)` in `logic.ts`, used for the chart meta and its `aria-label`. I checked the other count labels; none were wrong. | Unit: `plural (BUG-5a)` (1 batch, 0 batches, 1,200 batches), and `views.test.tsx` renders the chart with one point, asserting `1 batch` and no `1 batches`. |

The fairness link still points to `/#how-it-works`. I didn't edit any landing files.

| Check | Command | Result |
|-------|---------|--------|
| Typecheck | `npm run type-check` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Unit | `npx deepspace test run unit --port 5187` | exit 0, `Test Files 17 passed (17)`, `Tests 266 passed (266)` |
| e2e | `npx deepspace test run e2e --port 5187` | exit 0, `28 passed`, `1 skipped` (opt-in screenshots), 1.0 min |

Files changed: `src/components/trading/OrderTicket.tsx`, `src/components/trading/PriceChart.tsx`, `src/components/trading/logic.ts`, `src/components/trading/logic.test.ts`, `src/components/trading/views.test.tsx`, `tests/smoke.spec.ts`. All are in my ownership list. No open requests for the director.

---

## Review round 2

**Review round 2, on code commit `1206662`.** Every check was rerun by me on that commit.

| Item | Result |
|------|--------|
| **R2-1** | Both live-order queries in `trade.tsx` are now `where: { roundId, status, userId }`, so the limit is spent only on my own live rows. The page is behind the sign-in gate, so `userId` is always set; if it is ever missing, the query uses `NO_ROUND`, which matches nothing. The e2e resting-order and cancel steps still pass on the real RecordRoom. |
| **R2-2** | `formatCents(cents, { whole: true })` rounds (`Math.round`, `src/theme/format.ts:16`); it does not truncate. So the collab tolerance stays at ≤ $0.50, which is correct for rounding. `data-testid="my-equity"` exists (`src/components/trading/MyOrders.tsx:171`) and the collab test already reads it. |
| **R2-3** | Confirmed in `src/server/exchange/core.ts`. `closeRound` writes only `{ phase: 'break', phaseEndsAt }` to meta (line 401) and emits `ex.phase` with `m.roundId` (line 403). `snapshot()` sends `m.roundId` (line 283). A new id is only made in `openRound` (line 326), when the break ends. So during the break, both messages carry the **just-closed** round, which is the id `finishedRound(records, stream.roundId)` looks up. New test in `views.test.tsx`: `finishedRound` over a closed round and an older round, rendered through `RoundBreakOverlay`. It asserts exactly 2 `final-standing` rows in equity order (Ana, Bo), the bot filtered out, the older round ignored, and no "Tallying". |

| Check | Command | Result |
|-------|---------|--------|
| Typecheck | `npm run type-check` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Unit | `npx deepspace test run unit --port 5187` | exit 0, `Test Files 17 passed (17)`, `Tests 262 passed (262)` |
| e2e | `npx deepspace test run e2e --port 5187` | exit 0, `27 passed`, `1 skipped` (opt-in screenshots), 48.4 s |

Files changed in this round: `src/pages/(app)/(protected)/trade.tsx` and `src/components/trading/views.test.tsx`, both in my ownership list. No open requests for the director.

---

## Review round 1

**Review round 1 fixes, on code commit `e48f195`.** Every check was rerun by me on that commit.

| Finding | Fix | Proof |
|---------|-----|-------|
| **F1** One `orders` query with `limit: 200` and no order or status filter could drop live orders from the panel and from `reservedBy`. | `trade.tsx` now runs two queries, `where { roundId, status: 'open' }` and `where { roundId, status: 'partial' }`, merged by the new `liveOrderRows` in `logic.ts`. An order caught in both sets during an open → partial move counts once, as partial. Finished orders never enter these queries, so they can't crowd out live ones. The engine caps a trader at 20 live orders, well under each query's limit of 100. | Unit: `liveOrderRows (F1)`, with 20 open + 1 partial giving 21 rows and the right reserved cash, and the dedupe case. e2e: the collab test's resting order still appears in A's open orders and is cancelled from there, so the `status` filter works against the real RecordRoom. |
| **F2** The leaderboard check only proved both pages agreed. | The collab test now also checks that A's leaderboard equity (whole dollars) is within $0.50 of A's own `my-equity` (portfolio × live `last`, in cents), using `toPass` because a batch can land between the two reads. | Both e2e runs below pass. |
| **Q1** Does the break overlay find the finished round? | Yes, from the engine code (`src/server/exchange/core.ts` `closeRound`/`openRound`): the `rounds` record id is the round id, the close writes `status: 'done'` with standings in one mirror row, and the next round's record is only written when that round opens. So during a break the newest round is the one `ex.phase` names. To not depend on "newest", the page now looks the round up by id (`finishedRound(records, stream.roundId)` over the 5 newest rounds) and shows standings only once that record is `done`. "Tallying" shows only until the mirror delivers the done record. One edge case: after an invariant halt, the done record has empty standings, so the overlay says "No human traders this round". | Unit: `finishedRound (Q1)`, where a done record with the matching id returns it, and a live, missing, or different-id record returns null. |

| Check | Command | Result |
|-------|---------|--------|
| Typecheck | `npm run type-check` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Unit | `npx deepspace test run unit --port 5187` | exit 0, `Test Files 17 passed (17)`, `Tests 261 passed (261)` |
| e2e run 1 | `npx deepspace test run e2e --port 5187` | exit 0, `27 passed`, `1 skipped` (opt-in screenshots), 48.2 s |
| e2e run 2 | same | exit 0, `27 passed`, `1 skipped`, 48.4 s |

Files changed in this round: `src/pages/(app)/(protected)/trade.tsx`, `src/components/trading/logic.ts`, `src/components/trading/logic.test.ts`, `tests/collab.spec.ts`. All are in my ownership list. No open requests for the director.

The round 2 and round 1 report follows unchanged, except the commit line in §7.

---

## Round 2

**Round 2 (after director answers):** I rebased `agent/ui-trading` onto `agent/exchange` at `cfc6d6d` (`workers: 1` and `id="how-it-works"`). The rebase was clean. I added an e2e check that the fairness link lands on the section, then reran every check on code commit `c792ecb`. Results are in §1. The round 1 text below is kept, with updates marked.


Built and verified against the real, merged exchange-runtime engine. No mocks, no fake streams. Port 5187 throughout. No paid LLM calls (`NEWS_LLM_IN_DEV` was never set; the log shows `[news] skipped llm_disabled_in_dev`).

## 1. Built and verified

Round 2: all commands were run by me on code commit `c792ecb`, rebased on `cfc6d6d`.

| Item | Proof | Result |
|------|-------|--------|
| Typecheck | `npm run type-check` (`tsc --noEmit`) | exit 0, no output |
| Lint | `npm run lint` (`eslint .`) | exit 0, no output |
| Unit | `npx deepspace test run unit --port 5187` | exit 0, `Test Files 17 passed (17)`, `Tests 257 passed (257)` (38 are new: `src/components/trading/logic.test.ts`, `views.test.tsx`) |
| e2e | `npx deepspace test run e2e --port 5187`, run twice back to back with `workers: 1` | exit 0 both times: `27 passed`, `1 skipped` (the skip is the opt-in screenshot test). Run 1 took 2.8 min: the trading test waited out a results break, as designed. Run 2 took 48.7 s. |
| Build | `npm run build` | exit 0 |
| `useExchangeStream()` connects like the SDK hooks: a JWT from `getAuthToken()` in `?token=`, nothing else identifying in the URL, anonymous when signed out. It handles `ex.snapshot`, `ex.batch`, and `ex.phase`. A fresh snapshot replaces all state, deltas before the first snapshot are ignored, and it reconnects with jittered backoff (0.5 s doubling to a 10 s cap). | `streamReducer` and `backoffMs` unit tests; e2e checks `data-connected="true"` and the round id on the real socket | pass |
| `/trade` is gated | smoke `'/trade is gated when signed out'`: shows the gate, with no terminal, ticket, or ladder in the DOM | pass |
| Fairness link lands on the explanation | smoke `'the fairness note links to the batch auction explanation'`: from `/trade`, clicking "How it works" goes to `/#how-it-works`; the section's heading is visible and the section is in the viewport | pass |
| Signed in, it renders real engine data | smoke `'ticket, ladder, chart, and leaderboard render with real engine data'`: live prices in all 3 tabs, the chart price, book levels during a live round, ticket enabled when live and disabled in a break, leaderboard loaded, all panels present, no console errors | pass |
| A buys and B sells into it, through the UI | collab `'A buys, B sells into it…'`: B buys first (long-only), then A bids at +4% while B offers at −4%. Each side's fills panel shows the fill for its own `orderId`. | pass |
| Both see the print in Tape | same test: a tape row with ORBT at A's fill price is shown on both pages | pass |
| Both leaderboards reflect the new equity | same test: both pages list both traders, and A's equity text is equal on A's and B's pages (`toPass`); A's positions show ORBT | pass |
| B can't see A's open order | same test: A rests a buy at −8%, and its `orderId` appears in A's open orders but not in `b.page.content()`. A then cancels it through the UI and the row disappears (this also covers cancel). | pass |
| Presence ticker | collab `'presence: B sees A move to CURA'`: B's OnlineTraders shows A on ORBT, then on CURA after A switches tabs | pass (round 1 flake fixed by `workers: 1`, see §2) |
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

- **Round 2 update: resolved for tests.** The director set `workers: 1`, and both round 2 e2e runs passed every presence test. Closing one of two tabs still hides you from the floor; the director records it as a known SDK limitation. Round 1 details:
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

**Round 2:** both requests below were answered in `cfc6d6d` (Q1 fixed for tests with `workers: 1`, the SDK behavior recorded as a known limitation; Q2 anchor added). Nothing is open.

Round 1 requests:


1. **DIRECTOR QUESTION: presence across sessions of the same user.** Pick one:
   - (a) Add `workers: 1` (or `fullyParallel: false, workers: 1`) to `tests/playwright.config.ts` so specs sharing accounts never overlap. This fixes the flake. The suite takes about 50 s serially.
   - (b) Also, or instead, fix the product behavior. Count connections per user in `FloorPresence`/`mergeOnline` (ui-shell), or ask the SDK to send `PRESENCE_LEAVE` only when a user's last connection closes. Today, closing a second tab hides the user from the floor.

   I recommend (a) now and (b) as a tracked fix.
2. **Landing anchor.** The fairness note links to `/#how-it-works`, but the "How a batch auction works" section in `src/pages/index.tsx` (owned by ui-shell) has no `id`. Please add `id="how-it-works"` to that `<section>`. Until then the link opens the landing page at the top.
3. No contract changes, no new dependencies, no `src/actions/index.ts` registrations needed.

## 6. Lessons

- **SDK `useQuery` with `orderBy` or `limit` re-queries on every change in its collection** (`RecordSocket` re-sends `core.subscribe` on each `RECORD_CHANGE`). On busy collections (tape, portfolios, orders, fills), query with `where` only and sort and slice on the client. Options identity doesn't matter: the hook keys on the JSON of the options.

- **`ex.phase` can arrive before `ex.snapshot`** on the first connect (the room's `ensureAwake` broadcasts first). The client must ignore deltas until it has a snapshot.
- **The book can be crossed between batches.** Resting orders wait for the next clear, so `depth` can show the best bid above the best ask. Don't show a negative spread.
- **Order and fill rows don't arrive in the action response.** `placeOrder` returns `{ orderId, batchId }`, and the rows show up about 1 s later through the mirror. Key test assertions on `data-order-id`.
- **Long-only rules matter in tests:** a trader must buy before selling (`insufficient_shares` otherwise).
- **`deepspace test run` needs the port free.** Stopping `dev start` from a background task can leave its child process listening. Use `npx deepspace dev kill --port <port>` (only for a server you started).
- **Specs that share test accounts must not run in parallel** while presence drops users by `userId` (see §5).

## 7. Branch and commit

- Branch: `agent/ui-trading`
- Fresh-review fix code commit: `07f8313`. This report is committed on top of it.
- Reviewer-fix code commit: `e5938cc`.
- Evaluator run 3 code commit: `3ba2718`, on `agent/exchange` at `e6cc3e4`.
- E2-1 code commit: `5b5503a`, on `agent/exchange` at `634b864`.
- Evaluator-fix code commit: `123426e`, on `agent/exchange` at `5d96efe`.
- Review round 2 code commit: `1206662`.
- Review round 1 code commit: `e48f195`.
- Round 2 code commit: `c792ecb`, rebased on `agent/exchange` at `cfc6d6d`. (Round 1 code commit was `462f1a4`, before the rebase.)
