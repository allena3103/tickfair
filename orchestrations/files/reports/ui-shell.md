# ui-shell report

Worker: ui-shell (wave 1). Worktree `C:/DeepSpace-project-ui-shell`, branch `agent/ui-shell`, port 5185.

## 1. Built and verified

All checks ran on commit `f7f383f`, the last code commit. This report is the only change after it.

| Item | Proof | Result |
|------|-------|--------|
| Typecheck | `npx tsc --noEmit` | exit 0, no output |
| Lint | `npm run lint` (`eslint .`) | exit 0, 0 errors and 0 warnings |
| Build | `npm run build` | exit 0. The prerendered landing in `dist/` contains "One second" |
| Unit tests | `npx deepspace test run unit --port 5185` | 7 files, 46 tests passed (26 of them are new, covering ui-shell) |
| Smoke and api e2e | `npx deepspace test run --port 5185` | 11 passed, 1 skipped (`/trade`, see §2) |
| All e2e incl. collab | `npx deepspace test run e2e --port 5185` | 14 passed, 1 skipped. Flaky once, see §2 |
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
- **Flaky scaffold test.** `collab.spec.ts` › "API status page renders loading success and error states" failed once in 5 runs. It asserts that a 100 ms "Loading integration catalog..." state is visible, so it's a timing race under 2 workers. That spec and page aren't mine, and the other 4 runs passed.
- **Reduced motion on the landing.** The CSS freezes every loop on the cleared frame (`@media (prefers-reduced-motion)` in `tokens.css`), but I didn't run a reduced-motion browser test for it.

## 3. Not built or cut

- **No real-time header countdown from the exchange socket.** The header `RoundStatus` reads the `rounds` collection, which gives a coarse countdown. The exact batch and round countdown belongs to ui-trading, which reads the socket (out of scope here).
- **No fairness audit drawer.** It's a nice-to-have in PLAN §8, and it isn't in this task.
- **No light theme or theme toggle.** The style tile commits to dark.

## 4. Files changed

All of them are inside the ownership table in `README.md`:

- **Owned in the task file:** `src/pages/index.tsx`, `src/pages/(app)/_layout.tsx`, `src/pages/(app)/rounds.tsx`, `src/components/shell/**`, `src/components/feed/**`, `src/theme/**` (which includes the self-hosted fonts and `OFL.txt`), `docs/design/**`, and `tests/smoke.spec.ts`.
- **Owned only in the README table:** `src/pages/(app)/home.tsx`, `src/nav.ts`, `src/styles.css`, `src/themes.css`, and `src/themes.ts`.
- **Deleted:** `src/components/Navigation.tsx`, also README-owned. `AppHeader.tsx` replaces it and keeps the `app-navigation`, `nav-sign-in-button`, `nav-user-name`, and `nav-user-email` test ids.

I didn't touch `contracts.ts`, `package.json`, the lockfile, `index.html`, `seo.ts`, or any other worker's files, and I added no npm dependencies.

## 5. Requests for the director

1. **`index.html`** (not mine): set `<html data-theme="floor">`, and change the first-paint background to `#0c0e10` (it's `#0a0a0a` now), adding the line `html[data-theme="floor"] { background-color: #0c0e10; color-scheme: dark; }`. The page looks right today, because the floor tokens are the CSS default. This is only for first-paint color and the polish gate.
2. **`src/seo.ts`** (not mine): set `title` to "tickfair | Fair-batch stock trading game" and `description` to "Trade three made-up stocks against everyone at once. Orders in the same second clear at one price. Fake money, 15-minute rounds." The scaffold text is still "is a real-time collaborative app."
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

Branch `agent/ui-shell`. The final code commit is `f7f383f`, and the report commit is the next one, on top of it.
