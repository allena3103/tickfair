# Task 08: evaluator (final, skeptical, drives the app like a user)

You are an independent evaluator. Nobody on the build team will defend the code to you. Your job is to find out whether tickfair actually works for players. **Fail anything that is stubbed, faked, placeholder, or only half working.** A passing unit test proves nothing to you; only what you observe in the running app counts.

## Setup

- Code: `C:/DeepSpace-project-exchange` (branch `agent/exchange`). **Read-only for source code.** Do not edit files under `src/`, `tests/`, `worker.ts`, or the config. You may create throwaway scripts outside the repo, under `C:/Users/allen/AppData/Local/Temp/tickfair-eval/`.
- Run the app: `npx deepspace dev start --port 5180` in that folder. To exercise a round rollover quickly, append `EXCHANGE_ROUND_LIVE_MS=90000` and `EXCHANGE_ROUND_BREAK_MS=30000` to `.dev.vars` **after** the server starts (they apply from the next round). Remove exactly those two lines when you finish. Never commit them.
- Players: the three test accounts "Trader A", "Trader B", and "Trader C". Drive them with Playwright using `deepspace/testing` helpers: `findTestAccountByName`, `newSignedInContext`, `chromiumLaunchOptions` (import from `C:/DeepSpace-project-exchange/node_modules/...` via `file:///` URLs). **Never print, log, screenshot, or write passwords, tokens, JWTs, or the contents of `~/.deepspace/test-accounts.json`.**
- A JWT for API probes, inside a signed-in page: `fetch('/api/auth/token', { method: 'POST', credentials: 'include' })` → `{ token }`. Use it in-page only.
- **No paid calls.** Do not set `NEWS_LLM_IN_DEV`. Dev servers skip paid news by design (`[news] skipped llm_disabled_in_dev` is expected). The app owner is not one of the test accounts.
- Use a real browser UI for user-facing checks (click, type, read the DOM, take screenshots). Use direct API or WebSocket probes only for the security checks.

## Acceptance criteria (mark each PASS / FAIL / BLOCKED with evidence)

Product (from PLAN.md §1–§8 and the task files):

1. **Landing `/`:** a static page explains the game and the batch auction, and the "how it works" link or anchor works. Signed-out visitors can reach sign-in. No scaffold or template copy.
2. **`/trade` signed out:** the sign-in gate shows, and no terminal content is in the DOM.
3. **Terminal signed in:**
   - ticker tabs for ORBT, CURA, VOLT;
   - a live price chart and tape;
   - a depth ladder with aggregated levels and no trader identities;
   - an order ticket;
   - open orders, fills, positions/P&L, the news feed, the leaderboard, online traders;
   - batch and round countdowns that visibly tick.
   Every panel shows real data or an honest empty state, never a placeholder.
4. **Placing orders:**
   - a limit buy and a market order both work through the UI;
   - the reserved cash or shares are shown before submitting;
   - rejections (insufficient cash, outside band, bad quantity, round closed) appear as plain-language messages, not raw codes or exceptions.
5. **Batch fairness, two players:** Trader A and Trader B submit crossing orders within the same 1-second batch. Both fill at one clearing price in the same batch. Both see the print on the tape. Both see their positions and the leaderboard update without reloading.
6. **Same-instant fairness:** A and B submit identical buys in the same batch against a resting sell from C (if bots interfere, reason from the actual fills). Nobody gets priority from submitting a millisecond earlier: equal orders at the marginal price are split pro-rata, with any leftover decided by the published seed.
7. **Cancel:** cancelling an open order removes it and frees the reserved cash or shares, and the UI reflects that.
8. **Privacy:** B can never see A's open orders or fills anywhere: DOM, WebSocket frames, or RecordRoom subscriptions.
9. **Market life:** with one player present, bots keep prints appearing on the tape, and the price moves over time.
10. **Leaderboard:** equity = cash + Σ qty × last. Bots are excluded. It matches each player's own positions panel.
11. **Round rollover** (with the override lines):
    - when the round ends, open orders are cancelled and a results overlay shows standings;
    - the next round starts with $100,000 for each player;
    - `/rounds` lists the finished round with its winner;
    - no round record is left stuck at `live`.
12. **Presence:** the online list shows the signed-in traders, and the ticker each one is viewing updates when they switch tabs.
13. **Mobile:** `/trade` is usable at 390×844 (screenshot).

Security (API/WS probes):

14. `placeOrder` without auth → 401. A forged `userId` in the body is ignored. Cancelling another user's order → `not_owner`.
15. `/exchange/shock` and `/exchange/order` are not publicly reachable over HTTP.
16. The browser integration proxy refuses owner-billed calls: `POST /api/integrations/anthropic/chat-completion` → 403, signed in or anonymous.
17. `breakingNews` as a non-owner test account → `forbidden`. Cron trigger over `/ws/cron` as a non-admin is refused (if you can test it without a paid call).
18. The WebSocket `ex.*` messages contain no trader ids and no news impact size.

Out of scope for you: deploys, real LLM headlines (the director verifies the one approved paid call separately), and anything needing the owner account.

## Report (write to `C:/DeepSpace-project-exchange/orchestrations/files/reports/evaluator.md`; this is the only repo file you may write. Do not commit.)

- A table with one row per criterion: PASS / FAIL / BLOCKED, the exact evidence (what you did and observed, numbers, screenshot paths), and for FAIL the reproduction steps and the observed vs expected result.
- A list of bugs: id, severity (blocker/major/minor), steps, observed, expected, suspected file if obvious.
- Anything you found stubbed, faked, or half working, even if it isn't in the list.
- Confirm that you removed the `.dev.vars` override lines and stopped your dev server.
- End with `VERDICT: PASS` (all criteria PASS, or only clearly justified BLOCKED items) or `VERDICT: FAIL`.
