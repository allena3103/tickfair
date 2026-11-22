# Task 04: ui-shell (Wave 1)

- Worktree: `C:/DeepSpace-project-ui-shell`, branch `agent/ui-shell`, port **5185**.
- Read first: `BRIEF.md`, `PLAN.md` §1, §8. Docs: `/design/overview.md`, `/design/direction.md`, `/design/style-tile.md`, `/design/anti-ai-gate.md`, `/design/product-polish.md`, `/guides/presence-and-cursors.md`.

## Owns

`src/pages/index.tsx`, `src/pages/_app.tsx`, `src/pages/(app)/_layout.tsx`, `src/pages/(app)/home.tsx`, `src/pages/(app)/rounds.tsx`, `src/pages/(app)/(protected)/api-status.tsx`, `src/pages/(app)/(protected)/settings.tsx`, `src/components/Navigation.tsx`, `src/nav.ts`, `src/styles.css`, `src/themes.ts`, `src/themes.css`, `src/components/shell/**`, `src/components/feed/**`, `src/theme/**`, `docs/design/**`, `tests/smoke.spec.ts`. (Expanded by the director after foundation to match the README ownership table.)

**Director addition during the build:** delete the scaffold placeholder pages `api-status.tsx` and `settings.tsx`, along with their nav entries and the scaffold test cases that exercise them. For this cleanup only, the builder may delete those cases from `tests/collab.spec.ts`. The `index.html` theme attribute and `src/seo.ts` copy are applied by the director at merge.

## Out of scope

The trading terminal page, order ticket, depth ladder, and anything that reads the ExchangeRoom socket. Those belong to ui-trading.

## Steps

1. **Design direction.** Write `docs/design/direction.md` (the six-prompt brief from `/design/direction`) and `docs/design/style-tile.md`. Screenshot 2–3 real trading UIs for reference into `docs/design/refs/`, and note what you borrow from each. The look is a dense, dark, legible trading floor, not a template.
2. **Theme tokens** in `src/theme/**`: colors, type pair, and up/down colors that are also distinguishable without color (arrows or signs).
3. **Static landing page `/`.** No providers and no hooks. It covers the pitch, a 3-step "how a batch auction works" with a small static diagram, the rules (long-only, 15-min rounds, $100k), and a sign-in CTA.
4. **App layout `(app)/_layout.tsx`.** Providers are mounted as the scaffold requires. Header has the app name, round status slot, online count, and user menu. Navigation: Trade, Rounds.
5. **Feed components** in `src/components/feed/`, each with loading, empty, and error states:
   - `NewsFeed`: `useQuery('news')` for the current round, newest first, with relative time;
   - `Tape`: `useQuery('tape')`, per ticker, newest first;
   - `Leaderboard`: props are `portfolios` plus `last: Record<Ticker, number>`. Equity = cash + Σ qty × last. It ranks, highlights the current user, and excludes bot ids (the `bot:` prefix). It's a pure component; ui-trading feeds it live prices.
   - `OnlineTraders`: `usePresence()` plus `usePresenceRoom(\`floor:${APP_ID}\`)` peer `ticker`.
6. **`/rounds` page.** `useQuery('rounds')` shows past rounds with the winner, standings, and duration.
7. **Anti-AI gate.** Run the grep gate from `/design/anti-ai-gate.md` and fix any hits.

## Verification

Real data only arrives after exchange-runtime merges, so verify empty and loading states now. Populated states get verified in D3.

- `tests/smoke.spec.ts`:
  - `/` renders real content with no providers, no WS, and no auth overlay;
  - `/rounds` renders its empty state;
  - app-root and nav are present;
  - signed out, `/trade` shows the auth overlay (the route is created by ui-trading; skip this case with a note if it doesn't exist yet).
- `collab`-style check for presence: two `users(2)` see each other in `OnlineTraders`. Put it in your smoke spec under a `describe('presence')`; ui-trading owns `collab.spec.ts`.
- Screenshots of `/` (desktop and mobile 390×844) and the app layout, via `npx deepspace test screenshot`.

## Acceptance

- [ ] `test run --port 5185` passes.
- [ ] The design docs exist, and screenshots are attached in the report.
- [ ] The anti-AI gate is clean.
- [ ] Final report per `BRIEF.md`.
