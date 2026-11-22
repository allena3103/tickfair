# ui-shell report

Worker: ui-shell (wave 1). Worktree `C:/DeepSpace-project-ui-shell`, branch `agent/ui-shell`, port 5185.

## Update: review of evaluator run 3 fixes (FAIL, F1-F4 fixed)

The fix commit is `7243698`.

| # | Finding | Fix |
|---|---------|-----|
| F1 | The PERF e2e grouped by subscription id, which is vacuous if the SDK re-subscribes with fresh ids, and its shell-tape filter could match nothing. | Every `core.subscribe` frame is now counted by query fingerprint (collection + where + orderBy + orderDir + limit), whatever its id. The shell tape is identified as a `tape` query whose `where` is exactly `{roundId}` (the chart's adds `ticker`). Before the reset, the test asserts at least one shell-tape subscribe was seen. After the reset, it allows at most one new subscribe in 30 s for each of shell tape, news, and portfolios (portfolios on `/home` only), which leaves room for a round rollover. The test now first waits for a live round with 45 s or more left, from the terminal's `data-phase` and `data-phase-ends-at`, so the window always has prints. That fixed a `/home` run that saw only 2 prints because the round was ending. |
| F2 | `RoundsList` imported `plural` from ui-trading's `trading/logic`. | New `formatCount(n, one, many)` in `src/theme/format.ts`, with a unit test (1, 0, 2, 1,200), used by `RoundsList`. The BUG-2 view test still covers "1 trader". |
| F3 | The limit-less tape query wasn't checked to show the newest print first. | Tape rows now carry `data-record-id` and `data-at`. The e2e collects the tape records from `core.record_change` frames, takes the newest print of the shell's round in `buildTape` order (time, then batch, then id), and asserts the first tape row has that record id (`toPass`, up to 10 s). |
| F4 | The `resubscribesOnChange` test was tautological. | Removed the test and the export. The query-builder test now asserts each builder's exact output: an equality `where` only, with no orderBy, orderDir, or limit. |

**Proof:** with the pre-fix Tape, NewsFeed, and home restored temporarily, the new e2e fails on both pages. The shell-tape fingerprint `["tape",{"roundId":…},"at","desc",60]` re-subscribed 27 times on `/home` (27 prints) and 26 times on `/trade` (26 prints). With the fix, both pages send 0 new shell subscribes, the newest-print check passes, and the chart's query (ui-trading) still re-sends about once per print (28–29).

**Checks on `7243698`:**
- `npx tsc --noEmit` and `npm run lint`: both exit 0.
- Unit: 17 files, 275 tests passed (one removed, one added).
- `npx deepspace test run e2e --port 5185`, two runs: both exit 0, with 33 passed and 1 skipped (ui-trading's opt-in screenshot test).

**Files touched:**
- **Mine:** `src/theme/{format.ts,format.test.ts}`, `src/components/feed/{RoundsList.tsx,Tape.tsx,queries.ts,logic.test.ts}`.
- **`tests/smoke.spec.ts`:** only the "feed subscriptions" describe.

## Update: evaluator run 3 items (BUG-2, PERF)

I rebased onto `agent/exchange` `e6cc3e4`. It was a fast-forward, since my earlier commits were already merged. The fix commit is `4fbf349`.

**BUG-2:** `/rounds` rows now say "1 trader" and "2 traders". The fix is in `RoundsList.tsx` and reuses the existing `plural()` from `trading/logic.ts`. A new unit case in `views.test.tsx` asserts `1 trader` and the absence of `1 traders`.

**PERF, root cause:** the options were not being rebuilt on each render. The SDK keys `useQuery` on `JSON.stringify(options)`, and all its scope callbacks are stable. The real cause is in the SDK's `RecordSocket`: on every `core.record_change`, any subscription to that collection with `orderBy` or `limit` gets a full `core.subscribe` re-sent under the same subscription id. So an ordered or limited `tape` query re-subscribes once per print, and an ordered or limited `portfolios` query once per fill.

**PERF, fix:** new `src/components/feed/queries.ts` (`tapeQuery`, `newsQuery`, `portfoliosQuery`, and `resubscribesOnChange`, which mirrors the SDK rule).
- `Tape`, `NewsFeed`, and home's portfolios query now use only an equality `where` (`roundId`, plus `ticker` for Tape). The SDK then applies each change locally. Round scoping already bounds them: at most about 900 prints per ticker per round, and the server returns the whole match when there's no limit. Sorting and slicing happen on the client, as before.
- The options are also memoized with `useMemo`.
- `useCurrentRound` and `/rounds` keep `orderBy` + `limit`, because rounds accumulate forever. A round is written only at its start and end, so they re-send about twice per round. Their options are now module constants.

**PERF, proof:**
- Unit (`logic.test.ts` › "feed subscriptions"): every hot-feed query has `resubscribesOnChange === false`, and the rule matches the SDK.
- e2e (`smoke.spec.ts` › "feed subscriptions"): counts `core.subscribe` frames sent over 30 s of live prints, on `/home` (with a `/trade` tab open, since prints run only while a terminal is open) and on `/trade`.

| Run | Prints in 30 s | ui-shell Tape | News | Portfolios (home) | Chart tape (ui-trading) |
|-----|----------------|---------------|------|-------------------|-------------------------|
| Old queries, `/home` | 25 | **25** | 0 | 0 | — |
| Old queries, `/trade` | 27 | **27** | 0 | 0 | 27 |
| Fixed, `/home` | 25 | **0** | 0 | 0 | — |
| Fixed, `/trade` | 21 | **0** | 0 | 0 | 21 |

Against the old queries the new test fails (25 > 1); against the fix it passes.

**For the director and ui-trading:** the remaining per-print re-subscribe on `/trade` is ui-trading's `PriceChart.tsx` (`tape`, `orderBy: 'at'`, `limit: 300`). It's about 1 per print, which accounts for roughly half of the original 1,335 frames. `trade.tsx` has the same pattern on `fills` (`orderBy` + `limit`, re-sent per fill) and on `portfolios` and `orders` (`limit`, re-sent per change). The fix is the same: an equality-only `where`, then sort and slice on the client. Those files aren't mine, so I didn't touch them. The e2e logs the chart's count but doesn't assert on it.

**Checks on `4fbf349`:**
- `npx tsc --noEmit` and `npm run lint`: both exit 0.
- Unit: 17 files, 275 tests passed.
- `npx deepspace test run e2e --port 5185`, two runs: both exit 0, with 33 passed and 1 skipped (ui-trading's opt-in screenshot test).

**Files touched:**
- **Mine:** `src/components/feed/{queries.ts (new),Tape.tsx,NewsFeed.tsx,RoundsList.tsx,logic.test.ts,views.test.tsx}`, `src/components/shell/useCurrentRound.ts`, `src/pages/(app)/{home.tsx,rounds.tsx}`.
- **`tests/smoke.spec.ts`:** added the "feed subscriptions" describe only, for the frame count you asked for.

## Update: evaluator fixes (BUG-1, BUG-4, BUG-5)

I rebased `agent/ui-shell` onto `agent/exchange` (`5d96efe`, everything merged including ui-trading). It was a fast-forward with no conflicts. The fix commit is `9476861`. BUG-2 is a known limitation and was left alone, as instructed.

| Bug | Fix | Test |
|-----|-----|------|
| **BUG-1**: `/#how-it-works` changed the URL but didn't scroll (client navigation from `/trade`, and direct load on 390×844 and 1280×600). | New `src/components/shell/useScrollToHash.ts`: a router effect on `location.hash` and `location.key` that calls `scrollIntoView` once the section has rendered. It's smooth, or instant under reduced motion. `index.tsx` calls it on mount and on hash change. It uses no SDK hooks, and effects don't run during prerender. I also added an in-page "How it works" link in the landing header (`data-testid="landing-how-link"`). | `smoke.spec.ts` › "landing hash links": direct load of `/#how-it-works` puts the heading in the viewport at **390×844** and **1280×600**, with `scrollY > 0`. A third case clicks the in-page link from the top at 390×844 (the section starts out of view) and checks it scrolls into view. ui-trading's existing "fairness note links to…" test covers navigating from `/trade`, and it passes. |
| **BUG-4**: the online count included users who left up to 5 minutes ago (SDK heartbeat), and your own row said "on floor" instead of your ticker. | `FloorPresence` now exposes `myTicker`, because PresenceRoom `peers` never include you. `mergeOnline` takes `selfTicker`, and the new `countOnFloor()` counts only floor connections (peers, plus you while connected). The header count and the panel's "N online" both use it. Heartbeat-only users are still listed, but under a "Recently active · not counted" label and marked "away". | Unit: self ticker, count excludes heartbeat-only users, signed-out count is 0, no ticker while disconnected, and the view labels recently active users. e2e presence: the count is exactly 2 with both users on the floor and **drops to 1 right away** when B leaves (B's heartbeat is still fresh). On `/trade`, A's own row shows `ORBT`. |
| **BUG-5**: the leaderboard rounded P&L to whole dollars ("$0 unchanged" against +$0.27 in positions). Your own name was truncated at 390 px. The diagram labels were on the wrong curves. | Leaderboard and rounds P&L now show cents (`<Delta kind="money">`), so the arrow, sign, and number match the positions panel. Equity stays in whole dollars. It's a column of totals, and ui-trading's collab spec already compares it to positions within $0.50. The name cell no longer truncates: it wraps (`break-words`, `min-w-[7rem]`), and the number columns are `whitespace-nowrap`. On the diagram, "▲ buyers" now sits past the end of the green demand curve and "▼ sellers" past the red supply curve. | Unit: a +27¢ portfolio shows `+$0.27` with `data-direction="up"`, and equity shows `$100,000`. Visual: direct load of `/#how-it-works` at 390×844 lands on the section, and each label sits next to its own curve. |

Checks on `9476861`:
- `npx tsc --noEmit` and `npm run lint`: both exit 0.
- `npx deepspace test run unit --port 5185`: 17 files, 266 tests passed (the whole merged app).
- `npx deepspace test run e2e --port 5185`, run 1: exit 0, with 30 passed and 1 skipped.
- The same command, run 2: exit 0, with 30 passed and 1 skipped.
- The skip is ui-trading's optional `/trade` screenshot test, which needs `TRADE_SCREENSHOTS_DIR`. The `/trade` gate test now runs and passes, because the route exists.

Files touched:
- **Mine:** `src/pages/index.tsx`, `src/components/shell/{FloorPresence.tsx,AppHeader.tsx,useScrollToHash.ts}`, `src/components/feed/{onlineList.ts,OnlineTraders.tsx,Leaderboard.tsx,RoundsList.tsx,logic.test.ts,views.test.tsx}`.
- **`tests/smoke.spec.ts`:** ui-trading has owned it since wave 2. I edited it on your instruction to add the e2e checks, adding cases and extending the presence test only.
- **Not edited:** `tests/collab.spec.ts` and every other ui-trading file.

**For ui-trading and the director:**
- `useOnlineTraders()` now also returns `onlineCount`.
- `OnlineTraders` lists heartbeat-only users under a separate label.

## Update: review round 2 (PASS with 2 minor findings, both fixed)

| # | Finding | Fix | Proof |
|---|---------|-----|-------|
| F1 | `NewsFeed` called `new Date(publishedAt).toISOString()`, which throws RangeError on a missing or non-numeric value and blanks the page. | `<time>` is rendered only when `publishedAt` is a finite number inside the valid Date range (±8.64e15 ms). The headline still shows, but without the time or the "new" flag. Bad values sort last. | `views.test.tsx` › "survives a missing or malformed publishedAt": `undefined`, `'soon'`, `NaN`, and `1e20` all render with no throw and no `<time>` element. |
| F2 | `mergeOnline` always marked the viewer `onFloor: true`, so while reconnecting the self row said "on floor" under the "Lost the floor connection" alert. | `mergeOnline` takes `selfOnFloor`, and `useOnlineTraders` passes `status === 'connected'`. While the socket is down, the self row shows as off the floor with no ticker. | `logic.test.ts` › "does not mark yourself on the floor while your socket is down". |

Checks on `fdc8e1f`:
- `npx tsc --noEmit` and `npm run lint`: both exit 0.
- `npx deepspace test run unit --port 5185`: 11 files, 119 tests passed.
- `npx deepspace test run e2e --port 5185`: exit 0, with 12 passed and 1 skipped (`/trade`, which ui-trading hasn't built yet).

## Update: review round 1 (PASS with 4 minor findings, all fixed)

| # | Finding | Fix | Proof |
|---|---------|-----|-------|
| F1 | The `/trade` gate test used `isVisible({timeout})`, which doesn't wait, so it raced the lazily loaded 404 page. | `tests/smoke.spec.ts` now waits for either outcome with a real assertion, `expect(notFound.or(gate).first()).toBeVisible({ timeout: 15_000 })`, and only then decides whether to skip. | Both e2e runs below skip the test cleanly, with no failures. |
| F2 | `RoundsList` showed "No human traders" next to "N traders" when `winnerId` was missing, stale, or a bot. | The winner now falls back to the top human standing (standings are sorted best-first). "No human traders" appears only when the standings hold no humans. | `views.test.tsx`: the fallback is checked for `winnerId` set to `''`, `'gone'`, and `'bot:mm'`, plus a case with no humans. |
| F3 | With no resolved round, `NewsFeed` and `Tape` queried every round, and the round query's error was never shown. | New `resolveFeedRound` and `feedStatus` in `src/components/shell/useCurrentRound.ts`. With no round they query `NO_ROUND` (`'__no_round__'`), which matches nothing. A round loading or error state takes precedence over the feed's own status. `NewsFeed`, `Tape`, and the portfolios query on `/home` all use them, so the three behave the same. | `logic.test.ts` › "round-scoped feeds": 3 cases covering the sentinel, an explicit round id, and error and loading precedence. |
| F4 | `Delta` took its arrow and color from the raw value, but the label was rounded, so it could show "▲ 0.00%" or "▲ $0". | New `displayDelta(value, kind, { whole })` in `src/theme/format.ts`. It rounds once (half away from zero) and takes both the label and the direction from the rounded value. `Delta`'s props are now `{ value, kind: 'price' \| 'percent' \| 'money', whole? }`, and the free-form `children` and `percent` props are gone. I updated the callers in `Leaderboard`, `RoundsList`, and `home.tsx`. | `format.test.ts` › "derives the arrow from the displayed value": rounded-to-zero cases (±0.004% → `· 0.00%`, ±49¢ whole → `· $0`, ±0.4¢ → `· 0.00`), the boundaries (±0.005% → ±0.01%, ±50¢ → ±$1), and NaN. |

Checks on `15ca254`:
- `npx tsc --noEmit` and `npm run lint`: both exit 0.
- `npm run build`: exit 0.
- `npx deepspace test run unit --port 5185`: 11 files, 117 tests passed (32 of them cover ui-shell, up from 26).
- `npx deepspace test run e2e --port 5185`, run 1: exit 0, with 12 passed and 1 skipped.
- The same command, run 2: exit 0, with 12 passed and 1 skipped.
- The skip is `/trade`, which doesn't exist until ui-trading adds it.

**Note for ui-trading:** `<Delta>` now takes `kind` and `whole` instead of `percent` and `children`. Write `<Delta value={pnlCents} kind="money" whole />` or `<Delta value={ratio} kind="percent" />`. Round-scoped feeds should use `resolveFeedRound` and `feedStatus`.

## Update: round 2 (director addition)

- I rebased `agent/ui-shell` onto `agent/exchange` (`99497b3`, which includes engine-core and market-sim) with no conflicts.
- I deleted the scaffold placeholder pages `src/pages/(app)/(protected)/api-status.tsx` and `settings.tsx`.
  - Nothing in `src/` or `nav.ts` linked to either page.
  - `src/router.ts` is generated and gitignored. The build regenerated it without either route.
  - `prerender.ts` still mentions `/settings` in a comment. That file isn't mine, so I left it.
- In `tests/collab.spec.ts` I removed the two `/api-status` cases, one of which was the flaky test.
  - I kept "each browser renders its own signed-in account". It checks that two browser contexts hold separate sessions, which the presence test and multiplayer trading rely on.
  - `smoke.spec.ts` had no cases for either page.
- The checks below were rerun after this change.

## 1. Built and verified

These checks ran on commit `80a20d4`, after the rebase and the placeholder removal. The latest checks on `15ca254`, after the review fixes, are in the review update at the top of this report.

| Item | Proof | Result |
|------|-------|--------|
| Typecheck | `npx tsc --noEmit` | exit 0, no output |
| Lint | `npm run lint` (`eslint .`) | exit 0, 0 errors and 0 warnings |
| Build | `npm run build` | exit 0. The prerendered landing in `dist/` contains "One second", and the generated router no longer lists `/api-status` or `/settings` |
| Unit tests | `npx deepspace test run unit --port 5185` | 11 files, 111 tests passed (the total now includes engine-core and market-sim; 26 of them cover ui-shell) |
| e2e, run 1 | `npx deepspace test run e2e --port 5185` | exit 0: 12 passed, 1 skipped (`/trade`, see §2) |
| e2e, run 2 | the same command | exit 0: 12 passed, 1 skipped |
| Anti-AI gate | Every grep from `/design/anti-ai-gate.md`, run over `src/pages/index.tsx`, `src/components/{shell,feed}`, `src/theme`, home, and rounds. The emoji check ran in node, because this grep has no `\x{1F000}` support | 0 hits on every block |
| Product-polish gate | Half 1 (`<select`/confirm/alert/prompt, placeholder copy) and half 2 (`home pattern:` comment, `data-theme=` block) | Clean, except `index.html` still says `data-theme="slate"`, which I don't own (see §5) |

What the tests cover:

- **Static landing `/`** (`smoke.spec.ts` › landing):
  - The real H1, the how-it-works section, the rules, and the CTA all render. The CTA links to `/trade`.
  - There's no scaffold copy, no `auth-overlay`, and no app nav.
  - There are no console errors, no `/api/auth/` request, and no `/ws/` socket.
  - The page has exactly one title, one description, and one canonical link.
- **App shell** (`/home`): app-root, header, Trade and Rounds links, `round-status`, `online-count`, and the sign-in button are all present. The sign-in button opens the SDK auth overlay.
- **Feed states:**
  - On `/home`, all four panels leave the loading state and show no error. With no data they show their empty states.
  - Unit tests (`views.test.tsx`) cover the loading, empty, error, and populated states of `Leaderboard`, `NewsFeedView`, `TapeView`, `OnlineTradersView`, and `RoundsView`.
- **`/rounds`:** the empty state renders, the Rounds nav link is `aria-current`, and there are no console errors.
- **Presence** (`smoke.spec.ts` › presence, `users(2)`):
  - Each of the two accounts sees the other in `OnlineTraders` with `data-on-floor="true"`.
  - The header count rises above 1.
  - When B leaves for `/`, A's list drops B's on-floor marker.
- **Logic** (`logic.test.ts`, `format.test.ts`):
  - Equity is cash plus Σ qty × last, and it handles holdings stored as a JSON string or as junk.
  - Bots (`bot:` ids) are excluded, and tied traders share a rank (1, 2, 2, 4).
  - Each tape print is diffed against the previous print of the same ticker.
  - The online list puts you first, then floor peers, then heartbeat-only users.
  - The round phase covers live, break, none, and loading.
  - Money, sign, percent, relative-time, and clock formatting.

Screenshots (`npx deepspace test screenshot`), all in `docs/design/screenshots/`:

- `landing-desktop.png`: 1440×900, full page.
- `landing-mobile.png`: 390×844, full page.
- `app-home-desktop.png`: the app layout with the empty floor.
- `app-home-mobile.png`
- `app-rounds-desktop.png`

Design references are in `docs/design/refs/` (Binance spot, Kraken Pro, TradingView). What each one lends is listed in `docs/design/direction.md`.

## 2. Built but unverified

- **Populated feeds against real records.** Nothing writes `news`, `tape`, `portfolios`, `rounds`, or `tickers` until exchange-runtime merges. Populated rendering is unit-tested on the views only, so it gets checked in D3. Some assumptions to confirm then:
  - `useQuery` `orderBy` works on data columns (`at`, `publishedAt`, `startsAt`, `endsAt`). The components also sort on the client, so a wrong guess is harmless.
  - The engine writes a `rounds` record with `status: 'live'` when a round starts. `useCurrentRound` takes the newest `startsAt` as the current round.
  - `tickers.lastCents` and `openCents` stay current. `/home` uses them as `last` for the leaderboard.
- **`/trade` signed-out gate.** The test exists, but it skips itself at runtime while `/trade` returns 404. It runs automatically once ui-trading adds the route.
- **Flaky scaffold test: resolved.** The timing-sensitive `/api-status` collab case is gone along with the page (see the update above). Both e2e runs after the change were green.
- **Reduced motion on the landing.** The CSS freezes every loop on the cleared frame (`@media (prefers-reduced-motion)` in `tokens.css`), but I didn't run a reduced-motion browser test for it.

## 3. Not built or cut

- **No real-time header countdown from the exchange socket.** The header `RoundStatus` reads the `rounds` collection, which gives a coarse countdown. The exact batch and round countdown belongs to ui-trading, which reads the socket (out of scope here).
- **No fairness audit drawer.** It's a nice-to-have in PLAN §8, and it isn't in this task.
- **No light theme or theme toggle.** The style tile commits to dark.

## 4. Files changed

All of them are inside the ownership table in `README.md`:

- **Owned in the task file:** `src/pages/index.tsx`, `src/pages/(app)/_layout.tsx`, `src/pages/(app)/rounds.tsx`, `src/components/shell/**`, `src/components/feed/**`, `src/theme/**` (which includes the self-hosted fonts and `OFL.txt`), `docs/design/**`, and `tests/smoke.spec.ts`.
- **Owned only in the README table:** `src/pages/(app)/home.tsx`, `src/nav.ts`, `src/styles.css`, `src/themes.css`, and `src/themes.ts`.
- **Deleted:**
  - `src/components/Navigation.tsx`, also README-owned. `AppHeader.tsx` replaces it and keeps the `app-navigation`, `nav-sign-in-button`, `nav-user-name`, and `nav-user-email` test ids.
  - `src/pages/(app)/(protected)/api-status.tsx` and `settings.tsx`, which are README-owned and deleted on your instruction.
- **Edited with one-time approval:** `tests/collab.spec.ts`. I removed only the two `/api-status` cases.

I didn't touch `contracts.ts`, `package.json`, the lockfile, `index.html`, `seo.ts`, or any other worker's files, and I added no npm dependencies.

## 5. Requests for the director

1. **`index.html`** (not mine; you'll apply this): set `<html data-theme="floor">`, and change the first-paint background to `#0c0e10` (it's `#0a0a0a` now), adding the line `html[data-theme="floor"] { background-color: #0c0e10; color-scheme: dark; }`. The page looks right today, because the floor tokens are the CSS default. This is only for first-paint color and the polish gate.
2. **`src/seo.ts`** (not mine; you'll apply this): set `title` to "tickfair | Fair-batch stock trading game" and `description` to "Trade three made-up stocks against everyone at once. Orders in the same second clear at one price. Fake money, 15-minute rounds." The scaffold text is still "is a real-time collaborative app."
3. **For ui-trading:**
   - Call `useFloorPresence().setTicker(t)` from `@/components/shell/FloorPresence` when the user switches tickers. Don't call `usePresenceRoom` again, because the layout already holds the one `floor:${APP_ID}` socket.
   - Render `<Leaderboard portfolios={records.map(r => r.data)} last={liveLast} currentUserId={userId} status={...} />` with the stream's `last`.
   - Use `<Delta>` and `src/theme/format.ts` for every price and P&L, so up and down stay readable without color.
   - Up and down colors are available as Tailwind tokens: `text-up`, `text-down`, `bg-up-muted`, and `bg-down-muted`.
   - Smoke ownership passes to ui-trading in wave 2. The `/trade` gate test un-skips itself once the route exists.
4. **No `src/actions/index.ts` registrations, contract changes, or dependencies are needed.**

## 6. Lessons

- **Don't kill dev servers with `TaskStop` alone.** Stopping the background task leaves the vite child holding the port. Use `npx deepspace dev kill --port <port>`, and only on your own port. Free the port before `test run`, because the Playwright config uses `reuseExistingServer: false` and fails with `port_in_use`.
- **Watch filename case on Windows.** `tape.ts` next to `Tape.tsx` fails typecheck with TS1149 (the names differ only in case). Give logic modules different names (`tapeRows.ts`, `rank.ts`).
- **Don't load fonts from Google.** The production CSP for HTML pages (`secureDocumentationResponse` in `deepspace/dist/worker.js`) only allows same-origin stylesheets, so a Google Fonts `@import` would break. Self-host woff2 next to the CSS, and Vite bundles them.
- **Keep the static landing to CSS-only motion.** It's prerendered, so animate with keyframes and gate them with a `prefers-reduced-motion` media query. No hooks or timers.
- **Test empty, loading, and error states with `renderToStaticMarkup`.** It runs in Vitest's node environment and needs no DOM library. That's the cheap way to check states the e2e suite can't reach yet.
- **Wait for `/home` on a cold start.** The first dev load takes several seconds while vite compiles, and the page sits blank (AuthBoot) meanwhile. Use `--wait-for-selector` in screenshots.

## 7. Branch and commit

Branch `agent/ui-shell`, rebased onto `agent/exchange` `e6cc3e4`. The final code commit is `7243698` (reviewer F1-F4), and the report commit is the next one, on top of it.
