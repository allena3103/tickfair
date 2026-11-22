# Foundation report

Worker: foundation · Worktree `C:/DeepSpace-project-foundation` · Branch `agent/foundation` · Port 5181

## 1. Built and verified

All checks were rerun on code commit `221039e` (after the director's reject-code decision). Test logs are local. No credentials, tokens, or JWTs were printed or committed.

| Item | Proof | Result |
|---|---|---|
| Scaffold: `create-deepspace@latest tickfair` (starter, `deepspace` 0.44.2 exact), moved to the worktree root with the existing docs kept | commit `a16c931` | done |
| App registered (not deployed) | `npx deepspace app init --json` | `{"ok":true,"status":"registered","appId":"app_01M80AVDTA8NPYNJWXARJYZRPG",...}`. The id is in `wrangler.toml` |
| `dev start` boots on 5181 | `npx deepspace dev start --port 5181`, then `curl /api/auth/ok` | `VITE v8.3.8 ready`, `Local: http://localhost:5181/`, auth/ok answered. Server stopped afterwards with `dev kill --port 5181` |
| Typecheck | `npx tsc --noEmit` | exit 0, no output |
| Lint | `npm run lint` (`eslint .`) | exit 0, no findings |
| Unit | `npx deepspace test run unit --port 5181` | `Test Files 4 passed (4)`, `Tests 20 passed (20)`, exit 0 |
| e2e (smoke + api) | `npx deepspace test run --port 5181` | `8 passed (17.4s)`, exit 0. `collab.spec.ts` skipped by the default suite (not mine) |
| Build | `npm run build` (`vite build`) | `✓ built in 2.06s`, prerender wrote `/`, exit 0 |
| Schema-lint: zero warnings | `src/schemas/schemas.test.ts` runs `lintSchemas(schemas)` (the same check `SchemaRegistry` runs at RecordRoom boot) and expects `[]`. Also `grep -c schema-lint` on the e2e and spike webServer logs | test passes; 0 log lines |
| RBAC: no client writes on any exchange collection, for any role including admin; `orders`/`fills` are `'own'` with `ownerField: 'userId'` and `userBound` (admin also `'own'`, anonymous `false`); the other five are readable by every role including `'*'` | `schemas.test.ts` (3 tests) | pass |
| Contracts | `src/shared/contracts.ts`: every BRIEF contract verbatim, plus `invalid_side` and `invalid_type` in `RejectCode` (director decision 2). Types and constants only | tsc clean |
| ExchangeRoom shell: `extends BaseRoom<Env>`, in `__DO_MANIFEST__` (`EXCHANGE_ROOMS`, `ExchangeRoom`, sqlite) plus `wrangler.toml` migration `v2` and binding. `POST /exchange/{order,cancel,shock}` → `{ok:false, code:'round_closed'}` (documented placeholder) | spike spec, build | see SPIKE.md S1 and the action table |
| WS route `/ws/exchange/:roomId`: scaffold `wsRoute` pattern, JWT-only identity, anonymous = spectator, forged `?userId=` ignored, any room name except `exchange:${APP_ID}` → 404 | spike spec (`users(1)`) | signed: `userIdMatchesJwtSub:true, forgedIgnored:true`; anon: `anon-` prefix, `forgedIgnored:true`; wrong room `rejected`; curl → `HTTP 404` |
| Unauthenticated `placeOrder` → 401 | `curl -X POST /api/actions/placeOrder` | `{"error":"Unauthorized"} HTTP 401` |
| Authenticated `placeOrder` → `round_closed` (proves action → DO) | spike spec, signed in via `users(1)` | `200 {success:false, error:'round_closed'}` for limit and market. `cancelOrder` same. Bad ticker → `invalid_ticker`, qty 1.5 → `invalid_qty` |
| Order param parsing (ticker, side, type, integer qty and limit, no limit on market, extra fields like `userId` dropped). A bad or missing side returns `invalid_side`; a bad or missing type returns `invalid_type` | `src/actions/orders.test.ts` (13 tests) | pass |
| Spike S1–S5 | `orchestrations/files/SPIKE.md` | S1 pass, S2 pass (lateness p50 19 ms / max 32 ms; interval mean 1000 ms; alarm stopped about 61 s after the last socket closed), S3 pass locally with the throttled-mirror recommendation, S4 schema saved, S5 = 3 usable accounts |
| Vitest runs `src/**/*.test.ts` | the scaffold's `vitest.config.ts` already includes `src/**/*.{test,spec}.{ts,tsx}` (no change needed) | 4 files picked up |
| `@noble/hashes` pinned | `package.json`: `"@noble/hashes": "2.4.0"` (exact) | `sha256('abc')` via `@noble/hashes/sha2.js` = `ba7816bf…15ad` (correct) |

## 2. Built but unverified

- **Production behavior of S1–S3.** Everything ran on local Miniflare. The real Cloudflare subrequest cap per alarm, alarm jitter, and the `/ws/exchange` route on `*.app.space` need the first deploy (director, D3).
- **S4 output shape.** `outputSchema` is `null` in `integrations info`. The paid `invoke` is the director's.

## 3. Not built or cut

- No matching, bots, rounds, news, or UI, as the task says. The ExchangeRoom only answers `round_closed` and broadcasts nothing yet. `sendExchange` and `broadcastExchange` helpers, typed to `ExchangeServerMsg`, are in place for exchange-runtime.
- The spike harness (heartbeat alarm, idle stop, S3 writer, debug route, spike spec) was **reverted** so the shell stays honest. It's kept in history at `1eafd2f` (revert `e662f3e`).

## 4. Files changed (all within ownership)

Scaffold output (all files from `a16c931`), plus: `worker.ts`, `wrangler.toml`, `package.json`, `package-lock.json`, `src/schemas.ts`, `src/schemas/users-schema.ts`, `src/schemas/exchange-schemas.ts`, `src/schemas/schemas.test.ts`, `src/shared/contracts.ts`, `src/actions/index.ts`, `src/actions/orders.ts`, `src/actions/orders.test.ts` (test next to the owned file; ownership moves with `orders.ts`), `src/server/exchange-room.ts`, `src/server/realtime-routes.ts`, `orchestrations/files/SPIKE.md`, and this report. `src/constants.ts` and `vitest.config.ts` were left unchanged; they already did what was needed. The temporary spike files are gone from the tree.

## 5. Requests for the director

1. **Contract additions (please approve or trim).** Beyond the BRIEF literals, `contracts.ts` adds named types for shapes the BRIEF only describes in comments: `ExchangeOrderRequest/Response`, `ExchangeCancelRequest/Response`, `ExchangeShockRequest/Response`, the record data shapes (`TickerRecord`, `OrderRecord`, `FillRecord`, `TapeRecord`, `PortfolioRecord`, `NewsRecord`, `RoundRecord`, `Standing`), and `OrderStatus` / `RoundStatus`. No values or names in the BRIEF changed.
2. **RejectCode gap: resolved.** Per the director's decision, `invalid_side` and `invalid_type` were added to `RejectCode` and are used by `parsePlaceOrder`. `BRIEF.md` was not edited; the director updates it at merge.
3. **Mirror rule for exchange-runtime (from S3):** write `orders` and `fills` with `X-User-Id` = the trader, and never send `userId` in an update. See SPIKE.md S3 gotchas 1–2. Please put this in the 05-exchange-runtime brief.
4. **News model:** noted by the director (the news task already specifies `claude-haiku-4-5`). It still needs a small `max_tokens`, since the default is 4096.
5. Registrations already in `src/actions/index.ts`: `placeOrder`, `cancelOrder`. `breakingNews` still needs adding when news merges.
6. FYI: `origin` (github.com/allena3103/tickfair) was already set on this repo; I didn't touch it. Nothing was pushed or deployed.

## 6. Lessons

- `deepspace test run` with no suite runs only smoke+api. A new spec file needs `test run all --grep "<title>"`. The test runner starts its own server on `--port`, so stop your own `dev start` on that port first (`npx deepspace dev kill --port <p>`).
- Playwright's cwd is `tests/`. Read repo files with `new URL('../file', import.meta.url)`.
- `userBound` columns are always overwritten with the caller's `X-User-Id` on create, even through `X-App-Action`. `immutable` columns make the *entire* update fail if the value differs.
- `tools.create(coll, data, recordId)` / `records.create` with `recordId` is an upsert (merge on existing). `records.deleteWhere` is capped at 500 rows per call.
- To see if a DO has gone idle, count only `readyState === 1` sockets. Closing sockets still show up in `getWebSockets()` for a moment.
- `@noble/hashes` 2.x is ESM with explicit subpaths: `import { sha256 } from '@noble/hashes/sha2.js'`.
- `BaseRoom.sendTo` / `broadcast` are typed to the SDK protocol union. Use the shell's `sendExchange` / `broadcastExchange` for `ExchangeServerMsg`.
- The ESLint config has no `@typescript-eslint/no-explicit-any` rule. A disable comment for it is itself a lint error.
- Git reports LF→CRLF warnings on every commit here (`core.autocrlf`). They're harmless.

## 7. Branch and commit

Branch `agent/foundation`. The code is verified at `221039e`. This report is committed on top of it; the final hash is given in the worker's closing message.
