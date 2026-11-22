# Spike results (S1–S5)

Run by the foundation worker on 2026-11-21, local dev (`deepspace` 0.44.2, Miniflare via `npx deepspace test run --port 5181`).

The harness was committed as `1eafd2f` ("SPIKE (temporary)") and reverted in `e662f3e`, so the shipped ExchangeRoom stays a shell. To rerun: `git show 1eafd2f` and apply it. The parts were:

- `src/server/exchange-spike.ts`: a `SpikeExchangeRoom extends ExchangeRoom` with a hello message on connect, a 1s heartbeat alarm, idle stop, and an S3 write job that runs inside the alarm.
- A local-only `/api/spike/exchange/:op` route, gated on `ALLOW_DEBUG_ROUTES === 'true'`.
- `tests/spike.spec.ts`, which uses the `users(1)` fixture. Only booleans and timings leave the browser. No token or credential is logged.

Command: `npx deepspace test run all --port 5181 --grep "exchange spike"` → `1 passed (3.1m)`, exit 0.

**Everything below is local only. Nothing was deployed.** Production timing and subrequest limits are still unverified (see S3).

## S1: custom room, JWT WebSocket, spectators: PASS (local)

- `ExchangeRoom extends BaseRoom<Env>` is registered in `__DO_MANIFEST__` (`EXCHANGE_ROOMS`, `sqlite: true`) and in `wrangler.toml` (migration tag `v2`, `new_sqlite_classes = ["ExchangeRoom"]`). `vite build` succeeds (see the final report).
- Route: `GET /ws/exchange/:roomId` uses the scaffold's `wsRoute` / `authenticatedRoomRequest` pattern. Any `roomId` other than `exchange:${DEEPSPACE_APP_ID}` gets a 404, so clients can't create stray rooms.

Observed in a signed-in browser (Trader account via `users(1)`):

| Connection | Result |
|---|---|
| `?token=<jwt>&userId=forged-user` | `anonymous:false`, `userIdMatchesJwtSub:true`, `forgedIgnored:true` |
| `?userId=forged-user` (no token) | `anonymous:true`, id prefix `anon-`, `forgedIgnored:true` |
| `/ws/exchange/exchange:someone-else` | `rejected` (404 before upgrade) |

Also checked with curl: `GET /ws/exchange/exchange:wrong` → `HTTP 404`.

## S2: 1s alarm cadence and idle stop: PASS (local)

The alarm re-arms at `scheduled + 1000`, so delays don't accumulate. Measured over 60 ticks (the first tick is excluded as warm-up):

| Metric (ms) | min | p50 | p95 | max | mean |
|---|---|---|---|---|---|
| lateness (fired − scheduled) | 8 | 19 | 29 | 32 | 19.4 |
| server interval between fires | 978 | 1000 | 1015 | 1020 | 1000.0 |
| client receive interval | 976 | 1000 | 1017 | 1026 | 1000.0 |

Idle stop: the rule is "no OPEN sockets for 60s → don't re-arm". 75s after the browser closed its sockets, `getAlarm()` was `null`. The last tick fired 61,004 ms after the close (61 ticks after the close, all with 0 sockets). After that, no more alarms fired.

Note: when counting sockets, filter `getWebSockets()` to `readyState === 1`. A socket that is closing still shows up for a moment.

## S3: RecordRoom writes from inside the alarm: PASS (local), production limit unverified

**Supported upsert-by-known-id:** `buildCronContext().records.create` has no id parameter. The working path is the same one server actions use: a RecordRoom stub fetch to `https://internal/api/tools/execute` with body `{ tool: 'records.create', params: { collection, recordId, data } }` and headers `X-App-Action: true` and `X-User-Id: <identity>`. (This is `tools.create(coll, data, recordId)` in `src/server/action-routes.ts`; see `executeTool` → `putRecord` in `dist/worker.js`.) If the id exists, `putRecord` merges into it (update). Otherwise it inserts. Verified: rewriting `${round}:ORBT:0` with `clearCents: 2222` read back as 2222, and the row count stayed 2n, not 2n+1.

Measured inside one alarm (writes to `tape`, then cleanup with `records.deleteWhere`, limit 500 per call):

| writes | parallel (`Promise.allSettled`) | sequential | errors |
|---|---|---|---|
| 1 | 30 ms | 14 ms | 0 |
| 10 | 45 ms | 143 ms | 0 |
| 40 | 141 ms | 583 ms | 0 |
| 200 | 727 ms | 3,155 ms | 0 |
| 1000 | 5,531 ms | 15,292 ms | 0 |

**Subrequest limit:** no subrequest error at any size, but Miniflare doesn't enforce Cloudflare's per-invocation subrequest cap, so this proves nothing for production. Each DO→RecordRoom fetch is one subrequest. Each alarm run is its own invocation with its own budget. The cap depends on the plan the app runs on (I believe it's low on Workers Free and much higher on Paid). Check this on the first deploy.

**Gotchas found (load-bearing for exchange-runtime):**

1. **`userBound` stamps the caller.** On create, `userBound` columns are overwritten with `X-User-Id`. For `orders` and `fills`, the mirror must write with `X-User-Id` = the trader's userId. With the owner's id, every order becomes the owner's and `'own'` reads break. Verified: an order created as `spike-trader-T` with `data.userId = <owner>` was stored with `userId = spike-trader-T`.
2. **`immutable` rejects the whole write.** An upsert that sends a different value for an immutable field (`userId` on orders/fills) fails with `Cannot modify immutable field 'userId'`, and none of its other fields apply. Observed: an owner-identity upsert of `{ status: 'filled', userId: <owner> }` left the status as `open`. The error string comes from `putRecord` in `dist/worker.js`. **Mirror updates must omit `userId`** (or send the identical value).
3. `deleteWhere` needs a `where` on a real field and caps at 500 per call. Drain in a loop.

**Recommendation for S3:** mirror from the alarm, after the batch transaction and the WS broadcast, with **one parallel `Promise.allSettled` fan-out, capped at 40 writes per tick** (about 140 ms locally, well inside a 1 s batch). Coalesce by recordId so each changed order, portfolio, or tape row is written at most once per flush. If a tick has more than 40 dirty rows, carry the rest to the next tick. That is the **throttled mirror**: the queue drains at ≤40 per batch and stays consistent because every write is an idempotent upsert by a server-generated id. Fills are append-only, keyed `${orderId}:${batchId}`, so a retry can't duplicate them. Tape rows are 3 per batch, so the per-tick floor is small. If the deployed plan's cap turns out to be low (~50), drop the cap to ~20 and flush every 2 batches. Market data (depth, last price, countdown) stays on the WS and is never mirrored per tick.

## S4: `anthropic/chat-completion` schema: DONE (info only, no paid invoke)

`npx deepspace integrations info anthropic/chat-completion --json`:

- billing: `per_actual_cost`, USD, varies with input, free-tier price differs.
- input: `{ model?: string (default "claude-opus-5-5"), max_tokens?: number ≥1 (default 4096), messages: { role: 'user'|'assistant', content: string | object[] }[] (required), system?: string, temperature?: 0..1 }`.
- output: **`outputSchema: null`**. The CLI doesn't document the response shape. The director's single paid `invoke` has to confirm it.

**News worker must set `model` explicitly** (e.g. `claude-haiku-4-5`, which the description lists under standard pricing) and a small `max_tokens` (~200). Otherwise every call defaults to `claude-opus-5-5` with 4096 max tokens.

## S5: usable test accounts: 3

`npx deepspace test accounts list --usable --json` → `count: 3` ("Trader A", "Trader B", "Trader C"), all `usableByFixture`. No accounts were created. No credentials were printed (only `name` was read from the output).

## Also verified with the spike spec (action → DO path)

Signed in via `users(1)`, calling `/api/actions/*` with the session's bearer token:

| Call | Response |
|---|---|
| `placeOrder` limit ORBT buy 5 @ 10000 | 200 `{success:false, error:'round_closed'}` |
| `placeOrder` market VOLT sell 1 | 200 `{success:false, error:'round_closed'}` |
| `placeOrder` ticker AAPL | 200 `{success:false, error:'invalid_ticker'}` |
| `placeOrder` qty 1.5 | 200 `{success:false, error:'invalid_qty'}` |
| `cancelOrder` orderId "nope" | 200 `{success:false, error:'round_closed'}` |
| `placeOrder` with extra `userId:'someone-else'` | 200 `{success:false, error:'round_closed'}` (field dropped by the parser) |
| `placeOrder` with no auth (curl) | **401** `{"error":"Unauthorized"}` |
