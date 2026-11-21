# Task 00: foundation (Wave 0, single writer)

- Worktree: `C:/DeepSpace-project-foundation`, branch `agent/foundation`, port **5181**.
- Read first: `BRIEF.md`, `PLAN.md` §3, §4, §10, §12 (spike).

## Owns

Scaffold output, `worker.ts`, `wrangler.toml`, `package.json` + lockfile, `src/constants.ts`, `src/schemas.ts`, `src/schemas/**`, `src/shared/contracts.ts`, `src/actions/index.ts`, `src/server/exchange-room.ts` (shell only), `src/server/realtime-routes.ts` (the exchange WS route), `vitest` config, `orchestrations/files/SPIKE.md`.

## Out of scope

Matching logic, bots, news, UI beyond the scaffold, styling. If any of these is needed to prove a spike, write the minimum and say so in the report.

## Steps

1. **Scaffold** a DeepSpace app (`npm create deepspace@latest`), app name `tickfair` (the director may rename it). Put it at the worktree root. If `create` refuses a non-empty directory, scaffold into a temp folder and move it in, keeping the existing docs. `npx deepspace dev start --port 5181` must boot.
2. **Contracts.** Create `src/shared/contracts.ts` exactly as in `BRIEF.md` "Frozen contracts". It holds types and constants only, with no logic.
3. **Schemas.** Add the 7 collections from the BRIEF table under `src/schemas/`, and extend `users` with `displayName` if the scaffold lacks one.
   - Every collection: client `create/update/delete: false` for every role, including `admin` (only server code writes).
   - `orders` and `fills`: `ownerField: 'userId'` with `userBound: true`, `read: 'own'`.
   - All others: `read: true`, plus `'*'` read for `tickers`, `tape`, `news`, `rounds`, `portfolios`.
   - Use `{kind:'json'}` for `holdings` and `standings`.
   - Schema-lint must report no warnings at worker boot.
4. **ExchangeRoom shell.**
   - `export class ExchangeRoom extends BaseRoom<Env>`, registered in `__DO_MANIFEST__` as `{ binding: 'EXCHANGE_ROOMS', className: 'ExchangeRoom', sqlite: true }`.
   - A JWT-verified WS route `/ws/exchange/:roomId` that copies the scaffold `wsRoute` pattern. It strips client identity and accepts anonymous spectators.
   - `onRequest` routing for `POST /exchange/{order,cancel,shock}`. Each returns `{ ok:false, code:'round_closed' }` until exchange-runtime implements it. This is a deliberate, documented contract placeholder; nothing else in the app pretends to work.
5. **Order actions.** `src/actions/orders.ts` with `placeOrder` and `cancelOrder`. Each forwards `ctx.userId` plus the validated params to the DO stub and maps `{ok:false, code}` to `ActionResult` errors. Register them in `src/actions/index.ts`. Ownership of `orders.ts` moves to exchange-runtime in wave 2.
6. **Spike, recorded in `orchestrations/files/SPIKE.md`** with commands and observed output:
   - **S1.** ExchangeRoom builds (`vite build`) and a signed-in browser receives a WS message from it. An anonymous connection works and gets spectator identity. A forged `?userId=` is ignored.
   - **S2.** A `setAlarm` 1s loop broadcasts a heartbeat. Measure jitter over 60 ticks, and confirm the alarm stops when the room has had no sockets for 60s.
   - **S3.** From inside the alarm, write to `app:${APP_ID}`'s RecordRoom:
     - find a supported way to **upsert by known recordId** (`buildCronContext` `records.create` has no id parameter, so check the server-action `tools.create(coll, data, recordId)` path and `dist/worker.d.ts`);
     - measure latency for 1, 10, and 40 writes in one alarm;
     - record any subrequest-limit error.
     If 40 writes per tick doesn't hold, document the throttled mirror (every N batches) as the recommendation.
   - **S4.** `npx deepspace integrations info anthropic/chat-completion --json`: save the input/output schema summary. **Do not** run a paid `invoke`; the director does that.
   - **S5.** `npx deepspace test accounts list --usable --json`: report how many accounts are usable. Don't create any.
7. **Vitest.** Make `npx deepspace test run unit` run `src/**/*.test.ts`.
8. Make `@noble/hashes` (sync SHA-256) a dependency for engine-core. Pin it.

## Acceptance

- [ ] `dev start` boots on 5181. `test run` (smoke + api) passes. `test run unit` runs (zero tests is fine).
- [ ] `tsc` is clean with zero schema-lint warnings.
- [ ] Unauthenticated `placeOrder` returns 401. Authenticated `placeOrder` returns `success:false, error:'round_closed'`, which proves the action→DO path.
- [ ] `SPIKE.md` answers S1–S5 with evidence, plus a clear recommendation for S3.
- [ ] Final report per `BRIEF.md`.
