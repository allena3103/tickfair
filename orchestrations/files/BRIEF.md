# Shared Brief: every worker reads this first

## Goal

Build a multiplayer simulated stock exchange on DeepSpace. Players sign in, get $100,000 in fake cash, and trade three fictional stocks against a live order book. Trades, positions, and the leaderboard update live for everyone. AI-written fake news moves a hidden "true value", and bots trade toward it. Orders that arrive at the same instant are handled fairly by a **frequent batch auction**. The full design is in `PLAN.md` at the repo root; read §2 (decisions), §3 (architecture), and the section your task points to.

## Priorities, in order

1. **Correct money.** Balances never go negative, no fills are duplicated, and allocation is deterministic. This is the hardest-reviewed path.
2. **A working core loop on the deployed app**, not features that only look complete.
3. **Use DeepSpace primitives** instead of rebuilding them: auth, RecordRoom/RBAC, server actions, CronRoom, the integration proxy, presence, and the testing fixture.
4. **Code a reviewer can read.** Use small modules and plain names, and comment only on non-obvious invariants.
5. Scope: when time is short, finish fewer things well. Report anything you cut, with a reason.

## Stack

- DeepSpace SDK `deepspace` (pinned by foundation; do not upgrade).
- Vite + React + Tailwind v4, using the scaffold's UI primitives from `src/components/ui`. Routes are file-based under `src/pages/`.
- Hono worker in `worker.ts`. Cloudflare Durable Objects: the scaffold's six rooms plus `ExchangeRoom extends BaseRoom`.
- Node 24, npm 11. Vitest for unit tests, Playwright via `npx deepspace test run` for e2e.
- Docs are the authority: https://docs.deep.space/llms.txt; append `.md` to any page URL. For exact types, read `node_modules/deepspace/dist/*.d.ts`.

## Working rules

- Work only in your worktree. The absolute path is in your task file. Use the port in your task file for every `dev start` and `test run`.
- **Edit only the files your task file says you own.** If you need anything else, including a new npm dependency or a change to `src/shared/contracts.ts`, stop and message the director with the exact change and why.
- Commit often on your own branch. **Never** merge, push, `deepspace deploy`, `deepspace push`, write secrets, or touch production.
- Never kill a dev server you didn't start.
- If you hit something that needs the user's decision (spending money, a failed load-bearing assumption, a product choice), stop and report it. Don't guess.
- **Before you report done**, run all of these yourself on your final commit and paste the exact commands and results in your report:
  - typecheck: `npx tsc --noEmit` (or the scaffold's `typecheck` script);
  - lint: the scaffold's `lint` script, if one exists (say so if none exists);
  - unit tests: `npx deepspace test run unit --port <your port>`;
  - your e2e specs: `npx deepspace test run --port <your port>` (plus `e2e` if your task owns `collab.spec.ts`).
  The director reruns the same checks. A report that says "done" without this evidence is sent back.
- Your work then goes to an independent reviewer. Findings come back to you as a numbered list. Fix them, rerun every check, and report again with the same evidence.
- **Test accounts:** use only the `users(n)` fixture from `deepspace/testing`. Three accounts exist ("Trader A", "Trader B", "Trader C"). Never print, copy, or commit their passwords, the contents of `~/.deepspace/test-accounts.json`, session tokens, or JWTs. Don't create or delete accounts.

## DeepSpace rules (from the docs; violating these is a defect)

- Records are envelopes: fields live under `record.data`.
- Hooks are only allowed under `src/pages/(app)/`. Top-level pages are static.
- Keep the `users` schema. Extend it; never rename it.
- Disable write controls until `useMutations().ready` / `canWrite`.
- Identity comes **only** from a verified JWT: `ctx.userId` in actions, or the room's `UserAttachment`. Never accept a userId from a request body, a URL, or a header.
- Clients get **no write access** to exchange collections. All exchange writes go through server code.
- Integration calls run server-side only (cron or owner-gated actions). No client UI can trigger a paid call.
- Secrets go in `npx deepspace secrets` only. Never put them in `.dev.vars`, the code, logs, or commits. The plan needs no secrets, so if you think you need one, ask.
- Server-action results never return raw `users` rows.

## Testing without real keys or money

- Engine and market logic are pure modules, tested with Vitest, deterministic, with seeded PRNG.
- For e2e, use `deepspace/testing`'s `users(n)` fixture with the existing test-account pool (`npx deepspace test accounts list --usable`). Don't create accounts; ask the director if fewer than 2 are usable.
- **Mock only the external integration boundary**: `page.route('**/api/integrations/anthropic/**')`, or an injected `callLLM` function in unit tests. App code, routes, and rooms stay real.
- Prefix test-created human-visible data with `__test-<timestamp>__` and clean it up in `finally`.
- Run real integration calls only when your task says so, and only once.

## Frozen contracts (foundation implements these in `src/shared/contracts.ts`)

Changing a contract requires the director's approval, because other workers code against these definitions.

### Units and tickers

```ts
export const TICKERS = ['ORBT', 'CURA', 'VOLT'] as const   // Orbital Compute (tech), Curaline Bio (biotech), Voltgrid Energy (energy)
export type Ticker = typeof TICKERS[number]
export type Side = 'buy' | 'sell'
export type OrderType = 'limit' | 'market'
// money: integer cents; quantity: integer shares; time: epoch ms; ids: server-generated strings
export const START_CASH_CENTS = 10_000_000
export const BATCH_MS = 1_000
export const ROUND_LIVE_MS = 15 * 60_000
export const ROUND_BREAK_MS = 2 * 60_000
export const PRICE_BAND_BPS = 1_000            // ±10% of last clear
export const MAX_ORDERS_PER_BATCH = 10
export const MAX_OPEN_ORDERS = 20
```

### Server actions (client → worker)

```ts
// POST /api/actions/placeOrder
export interface PlaceOrderParams { ticker: Ticker; side: Side; type: OrderType; qty: number; limitCents?: number }
export interface PlaceOrderData { orderId: string; batchId: number }
// POST /api/actions/cancelOrder
export interface CancelOrderParams { orderId: string }
// POST /api/actions/breakingNews   (owner only)
export interface BreakingNewsParams { ticker?: Ticker }
export type RejectCode =
  | 'round_closed' | 'invalid_ticker' | 'invalid_side' | 'invalid_type' | 'invalid_qty' | 'invalid_price' | 'outside_band'
  | 'insufficient_cash' | 'insufficient_shares' | 'self_cross' | 'rate_limited'
  | 'too_many_open' | 'not_found' | 'not_owner' | 'already_final' | 'forbidden'
// Actions return ActionResult: { success: false, error: RejectCode } on rejection.
```

### Worker → ExchangeRoom (DO stub fetch only; never publicly routed)

```ts
// POST /exchange/order  body: { userId, displayName, params: PlaceOrderParams } → { ok: true, data: PlaceOrderData } | { ok: false, code: RejectCode }
// POST /exchange/cancel body: { userId, orderId }                                → { ok: true } | { ok: false, code: RejectCode }
// POST /exchange/shock  body: { newsId, ticker, deltaBps, rampBatches }           → { ok: true } | { ok: false, code: 'round_closed' }
// Singleton room name: `exchange:${DEEPSPACE_APP_ID}`; binding EXCHANGE_ROOMS.
```

### ExchangeRoom → client WebSocket (`/ws/exchange/:roomId`, JWT via the scaffold's wsRoute pattern; anonymous = spectator)

```ts
export type Depth = { bids: [priceCents: number, qty: number][]; asks: [priceCents: number, qty: number][] } // top 10 levels, aggregated, no identities
export interface Print { ticker: Ticker; roundId: string; batchId: number; clearCents: number; volume: number; seed: string }
export type Phase = 'live' | 'break'
export type ExchangeServerMsg =
  | { type: 'ex.snapshot'; roundId: string; phase: Phase; phaseEndsAt: number; batchId: number; nextBatchAt: number;
      last: Record<Ticker, number>; depth: Record<Ticker, Depth>; recentPrints: Print[] }
  | { type: 'ex.batch'; roundId: string; batchId: number; nextBatchAt: number;
      last: Record<Ticker, number>; depth: Record<Ticker, Depth>; prints: Print[] }
  | { type: 'ex.phase'; roundId: string; phase: Phase; phaseEndsAt: number }
// Clients send nothing on this socket (orders go through server actions).
```

### RecordRoom collections (scope `app:${APP_ID}`; all client create/update/delete = false)

| Collection | recordId | data fields | read |
|------------|----------|-------------|------|
| `tickers` | ticker | symbol, name, sector, lastCents, openCents | `true` incl. `*` |
| `orders` | orderId | userId, ticker, side, type, qty, limitCents, filledQty, avgFillCents, status: `open`\|`partial`\|`filled`\|`cancelled`, batchId, roundId | `'own'` via ownerField `userId` |
| `fills` | `${orderId}:${batchId}` | userId, orderId, ticker, side, qty, priceCents, batchId, roundId | `'own'` via `userId` |
| `tape` | `${roundId}:${ticker}:${batchId}` | ticker, roundId, batchId, clearCents, volume, seed, at | `true` |
| `portfolios` | `${roundId}:${userId}` | userId, displayName, roundId, cashCents, holdings: `Record<Ticker, number>` (json) | `true` |
| `news` | newsId | roundId, ticker, headline, body, publishedAt | `true` |
| `rounds` | roundId | startsAt, endsAt, status: `live`\|`done`, standings (json `{userId, displayName, equityCents}[]`), winnerId | `true` |

The impact size of a news event is **never** stored in records or sent to clients.

### Presence

`usePresenceRoom(\`floor:${APP_ID}\`)`, peer state `{ ticker: Ticker }`. Online list via `usePresence()`.

## Final report (every worker ends with this, in this order)

1. **Built and verified:** each item, the exact command or test that proves it, and its output or result.
2. **Built but unverified:** what is in place and why it isn't verified yet.
3. **Not built or cut:** with the reason.
4. **Files changed:** confirm they're all inside your ownership list.
5. **Requests for the director:** contract changes, dependencies, registrations (for example `src/actions/index.ts` lines), or decisions needed.
6. **Lessons:** gotchas a later worker should know.
7. Branch name and final commit hash.
