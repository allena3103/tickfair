# exchange-runtime report

Branch `agent/exchange-runtime`, rebased onto `agent/exchange` at `ef0403b` (ui-shell, the breakingNews registration, and the `NEWS_LLM_IN_DEV` gate). No paid LLM call was made: `NEWS_LLM_IN_DEV` was never set, and the dev log shows only `[news] skipped llm_disabled_in_dev` / `[news] no event this minute`.

## Design in one paragraph

`ExchangeRoom` (src/server/exchange-room.ts) is a thin DO shell: clock, alarm, sockets, mirror I/O. All state changes live in `ExchangeCore` (src/server/exchange/core.ts), which is synchronous SQL over `SqlLike`, one `transactionSync` per step (intake, cancel, shock, batch, round open/close). A batch is: clear every ticker with `clearBatch` → `settleFill` per fill → save accounts → conservation check → `stepFundamental` → batchId+1 → bots re-quote via the same `submit` path → invariant check on touched accounts + bots → conservation check again. Any throw rolls the whole step back. Mirror writes are queued in a `mirror` outbox table inside the same transaction and drained after the broadcast (≤40 per tick, priority rounds → orders/fills/portfolios → tape → tickers). Because it is plain SQL, the core is unit-tested on real SQLite (`node:sqlite`), and the DO class itself is integration-tested with a fake DO state.

## 1. Built and verified

All commands run on the final commit, port 5186. Review round 1 fixes are in §8, round 2 in §9.

| Item | Proof | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit 0, no output |
| Lint | `npm run lint` (eslint .) | exit 0, no output |
| Unit (all) | `npx deepspace test run unit --port 5186` | exit 0: `Test Files 15 passed (15)`, `Tests 230 passed (230)` |
| E2E | `npx deepspace test run --port 5186` (smoke + api), twice on the final code (round 2) | each exit 0: `21 passed (57.5s)`, `21 passed (52.0s)`; `1 skipped` each. Assumes default round durations: no `EXCHANGE_ROUND_*` overrides in `.dev.vars` (ui-shell's `/trade is gated when signed out`, which waits for ui-trading's page); collab.spec.ts not in this run (not mine) |
| Build | `npx vite build` | exit 0, `✓ built`; the worker bundle does not contain `node:sqlite` |
| SQLite tables `meta, accounts, holdings, book, batches, fundamentals, bots` (+ `shocks` for newsId dedupe, `mirror` outbox) created on construct | `exchange/sql.ts`; every test constructs a fresh room | pass |
| Intake: lazy enroll with `START_CASH_CENTS`, `rate_limited` at `MAX_ORDERS_PER_BATCH` per trader per batch, `checkAndReserve`, server `orderId` (`o-<uuid>`), current `batchId`, `PlaceOrderData` | core.test `intake` (6 cases + 8 reject codes); api.spec `typed rejections…`, `a valid order returns orderId and batchId…` | pass |
| Cancel: releases the unfilled reservation; `not_owner`, `already_final`, `not_found` | core.test `cancel`; api.spec (B cancelling A's order → `not_owner`; second cancel → `already_final`) | pass |
| Market orders stored with the band-edge limit | core.test `stores a market order with the band-edge limit`; manual run: market buy stored `limitCents=13225` (= hi of band around 12023) | pass |
| Batch loop in one `transactionSync`, broadcast after commit, then mirror | core.test `batch` + room.test (ex.batch ids 2,3,4 after three alarms; fills/orders written with `X-User-Id` = trader; portfolios/tape/rounds as owner) | pass |
| Bots: cancel old quotes, re-quote through the same reserve path, ids `bot:mm` / `bot:noise`, intents clamped with `priceBand`, rejected intent logged and skipped, MM inventory updated from its fills, bots seeded with cash + shares each round | core.test `updates the maker inventory…` (inventory == holdings − seed; every bot order inside the band), `opens a live round…` (bots hold shares, 6 MM quotes in batch 1) | pass |
| Mirror: idempotent upserts by deterministic recordId, coalesced per record, ≤40/tick, carry-over, version-safe delete, failed rows never dropped (per-row backoff 1 s doubling to 64 s, warning per failure); bots get no `orders`/`fills` mirrors | core.test `mirror flush` (3 tests), `schema upgrade`; room.test identity checks and RecordRoom-outage test | pass |
| Shock: `applyShock` from the next batch, `round_closed` in the break, `bad_request` (HTTP 400) on malformed input, same `newsId` applied once; size never logged or sent | core.test `shock` (2 tests); room.test: real `ExchangeRoom.fetch('POST /exchange/shock', {CURA, deltaBps: 800, rampBatches: 15})` → `{ok:true}`; wire messages contain no `valueCents/targetCents/deltaBps/rampLeft` | pass — see numbers below |
| Rounds: start (new roundId, reset fundamentals + bots, seed bots, `rounds` live record + 3 `tickers` written immediately); end (cancel all, release, mark to market, `rounds` done with human-only standings and a human or empty `winnerId`, `ex.phase`); break → next round | core.test `round end` (2 tests); room.test rollover; manual rollover watch below | pass |
| First start and idle resume: start on first order/socket/shock; stale round closed, then next started; batch clock restarts instead of replaying | core.test `idle pause and resume` (4 tests); real dev server: the leftover round from an earlier test run was closed on wake (`[exchange] round r-mwr7cdtw-b2d812 done … 2 traders`) and a new one opened | pass |
| Idle pause: no open sockets and no orders for 5 min → alarm stops; while idle a live round still gets one wake at its end so no `rounds` record stays live; idle break waits for a visitor; shocks don't count as activity | core.test idle tests; room.test `…never leaves a rounds record live once idle` (alarm ends `null`, every rounds record `done`) | pass |
| Invariant self-check after every batch and at round end (`cash/reserved ≥ 0`, `qty ≥ reservedQty ≥ 0`, reservations equal live orders exactly, conservation of total cash and shares); violation → rollback, `console.error('[exchange] INVARIANT …')`, round halted (done, no standings, no winner), next round starts clean | core.test `invariant self-check` (corrupts the MM reservation; batch rolled back, one INVARIANT line, halted, next round `halted: 0`); 300-batch random-play test with no INVARIANT and conserved totals | pass |
| WS: `ex.snapshot` on connect, `ex.batch` per batch, `ex.phase` on transitions; depth top 10 aggregated, no ids | room.test; api.spec reads snapshots; manual run | pass |
| `src/actions/orders.ts`: type + range validation (qty ≤ `MAX_ORDER_QTY`, limit ≤ 100,000,000 cents, non-object params, order-id shape for cancel), name lookup can't block trading | `src/actions/orders.test.ts` (extended) | pass |
| api.spec: unauthenticated `placeOrder`/`cancelOrder` → 401; bad ticker/qty/price/band → typed errors; insufficient cash; cancel another user's order → `not_owner`; valid order returns `orderId` + `batchId`; orders private (B can't see A's) | `tests/api.spec.ts` | pass |
| Two-user API test: A buys and B sells in the same batch → both fill at one price, `tape` record `${roundId}:VOLT:${batchId}` with that price, both portfolios moved | api.spec `two users crossing in one batch…` | pass |
| Simultaneous fairness: identical marketable buys from A and B ack with the same `batchId`; every fill in that batch has the tape's single price | api.spec `identical simultaneous buys…` | pass |

### Price shock (fixed deltaBps, through the real DO class)

`src/server/exchange/room.test.ts` posts `POST /exchange/shock {ticker: 'CURA', deltaBps: 800, rampBatches: 15}` to `ExchangeRoom.fetch` and fires 45 alarms (one batch each). The round secret is random, so the path differs per run; earlier runs ended at +7.65% and +4.99% after 30 batches (the second one failed my first, too-tight +5% threshold, so the test now checks the hidden value finished its ramp above +6% and the price is above +4% after 45 batches; 6/6 reruns passed):

```
[exchange] shock n-1 CURA accepted for batch 4
[room.test] CURA last before shock 4500, after 45 batches 4852 (7.82%), hidden value 4850: 4500 4500 4500 4500 4500 4500 4500 4500 4500 4500 4500 4720 4720 4720 4720 4720 4794 4813 4817 4817 4817 4839 4839 4839 4839 4839 4839 4839 4854 4854 4854 4854 4854 4854 4854 4854 4838 4853 4853 4853 4853 4853 4853 4852 4852
```

### Manual local run (`npx deepspace dev start --port 5186`, one signed-in test account, ~2 min)

Driver: a gitignored Playwright script (`.deepspace/manual-run.mjs`, not committed) using `newSignedInContext` + `pickTestAccounts(1)`. Prints numbers only.

```
[t+5.7s] snapshot: phase=live batchId=1 last={"ORBT":12000,"CURA":4500,"VOLT":8000} round ends in 898s
[t+25.8s] bots: 21 ex.batch messages in ~20s, 13 prints, volume 333 shares
[t+25.8s] last now {"ORBT":12023,"CURA":4508,"VOLT":7987}; ORBT depth top bid [11990,69] top ask [12045,186]
[t+26.0s] placeOrder market buy 5 ORBT -> success=true batchId=23
[t+29.1s] order status=filled filledQty=5 avgFillCents=12041 limitCents(band edge)=13225
[t+29.1s] fills: 5@12041 (batch 23)
[t+29.2s] tape ORBT:23 clearCents=12041 volume=5
[t+29.3s] portfolios in round: 0 -> 1; mine cashCents=9939795 (start 10000000) holdings={"ORBT":5,"CURA":0,"VOLT":0}
[t+132.2s] total ex.batch messages: 128; total run 132s
```

Rollover in the real dev server (overrides `EXCHANGE_ROUND_LIVE_MS=60000`, `EXCHANGE_ROUND_BREAK_MS=15000`, see §5.2). The round that was live when the overrides went in kept its 15-min end; the next two rounds ran 60 s live / 15 s break. One order per round so standings hold a human. The first `rounds` line is the round left over from an earlier `test run`: when the dev server woke the room, it was closed properly (`[exchange] round r-mwr7cdtw-b2d812 done … 2 traders`) before a new round opened, which is the idle-resume path in the real runtime:

```
2026-11-22T04:39:31.650Z snapshot round=r-mwrch3si-2f440e phase=live endsIn=714s batchId=177
2026-11-22T04:39:31.778Z order in r-mwrch3si-2f440e: success=true 
2026-11-22T04:51:25.298Z ex.phase break round=r-mwrch3si-2f440e phaseEndsIn=15s
2026-11-22T04:51:40.799Z ex.phase live round=r-mwrd0pw4-6f167c phaseEndsIn=60s
2026-11-22T04:51:40.921Z order in r-mwrd0pw4-6f167c: success=true 
2026-11-22T04:52:41.031Z ex.phase break round=r-mwrd0pw4-6f167c phaseEndsIn=15s
2026-11-22T04:52:55.479Z ex.phase live round=r-mwrd2bts-c94607 phaseEndsIn=60s
2026-11-22T04:52:55.574Z order in r-mwrd2bts-c94607: success=true 
2026-11-22T04:53:45.180Z rounds r-mwr7cdtw-b2d812 status=done live=900s standings=2 winnerIsHuman=true topEquity=10000086
2026-11-22T04:53:45.182Z rounds r-mwrch3si-2f440e status=done live=900s standings=1 winnerIsHuman=true topEquity=10000269
2026-11-22T04:53:45.183Z rounds r-mwrd0pw4-6f167c status=done live=60s standings=1 winnerIsHuman=true topEquity=9999852
2026-11-22T04:53:45.183Z rounds r-mwrd2bts-c94607 status=live live=60s standings=0 winnerIsHuman=false topEquity=-
2026-11-22T04:53:45.185Z last batchId seen 50
```

`INVARIANT` lines in the dev-server log for the whole session: 0 (dev-server log, 4 rounds, ~17 min; also 0 in every `test run` log).

## 2. Built but unverified

- **Production subrequest budget.** The mirror sends ≤40 RecordRoom writes per alarm (SPIKE S3). Each alarm is its own invocation, but the deployed cap is still unmeasured. If it is low, change `MIRROR_WRITES_PER_TICK` in `exchange/config.ts`; the outbox already carries the rest over.
- **The shock from the real news pipeline in dev.** By the user's decision, dev servers make no paid LLM call, so news never reaches `/exchange/shock` locally. The shock endpoint was verified through the real `ExchangeRoom.fetch` in room.test (above), not through a running dev server: a local-only harness route would need `worker.ts`, which I don't own, and the edit was refused.
- **Mirror load during a long RecordRoom outage.** Rows are retried forever with per-row backoff, capped at 40 writes per tick. Because the cap spreads rows over many ticks, their retry times stagger, so during an outage with a big queue the room still wakes about once a second (each wake sends at most 40 writes) until RecordRoom recovers, even while idle. Measured in room.test only, not against a real outage.
- **Alarm timing under load in production** (only the local cadence was observed: 128 `ex.batch` messages in 132 s in the manual run).

## 3. Not built or cut

- No bot kill switch (per the task).
- `ex.batch.batchId` is the **open** batch (the one now collecting orders), not the batch that just cleared; prints carry their own `batchId`. Same meaning as `ex.snapshot.batchId` and the ack's `batchId`. Documented, not a cut, but ui-trading should know (§6).

## 4. Files changed

All within my ownership (`src/server/exchange-room.ts`, `src/server/exchange/**`, `src/actions/orders.ts`, `src/actions/orders.test.ts` (ownership approved in review round 1), `tests/api.spec.ts`), plus this report:

- `src/server/exchange-room.ts` (rewritten from the shell)
- `src/server/exchange/{config,core,invariants,mirror,sql,store}.ts` (new)
- `src/server/exchange/{core,room}.test.ts`, `src/server/exchange/test-db.ts` (test-only; `test-db.ts` loads `node:sqlite` through a computed specifier so it never enters the worker type program or bundle)
- `src/actions/orders.ts`, `src/actions/orders.test.ts`
- `tests/api.spec.ts` (news tests kept unchanged)
- `orchestrations/files/reports/exchange-runtime.md`

`git diff --stat agent/exchange..agent/exchange-runtime`: 14 files changed, 2515 insertions(+), 35 deletions(-) — but `orchestrations/files/PROGRESS.md` in that list is the director's `b19953a`, committed to `agent/exchange` after my rebase. My changes since the merge base `ef0403b` touch only the files below

Not committed, local only: `.deepspace/manual-run.mjs` and `.deepspace/rollover-watch.mjs` (gitignored folder). For the rollover run I appended two non-secret lines to the gitignored `.dev.vars` without reading the rest of the file, and deleted exactly those lines afterwards (`grep -c ^EXCHANGE_ROUND .dev.vars` → 0). I never set `NEWS_LLM_IN_DEV`. The dev server I started on 5186 was stopped with `npx deepspace dev kill --port 5186`.

## 5. Requests for the director

1. **Contract (optional):** `ExchangeShockResponse` only allows `code: 'round_closed'`. A malformed shock body now gets HTTP 400 `{ ok: false, code: 'bad_request' }`. Only our own news code calls it, so this never happens in practice; add `'bad_request'` to the type if you want it typed. `publish.ts` would log it as `published_no_shock (bad_request)`. **Approved; the director adds it to contracts.ts at merge. I did not edit contracts.ts.**
2. **Round-duration overrides in local runs:** `deepspace dev start` rewrites `.dev.vars` on every start, and with a `.dev.vars` present the Cloudflare plugin ignores process env (`CLOUDFLARE_INCLUDE_PROCESS_ENV` has no effect). The working method: start the server, then append `EXCHANGE_ROUND_LIVE_MS=…` / `EXCHANGE_ROUND_BREAK_MS=…` to `.dev.vars`; the worker reloads, and the **next** round uses them (the current round keeps its end time). If the evaluator needs this often, a supported way to pass extra local vars would help.
3. **Local-only shock harness:** if you want the shock exercised on a running dev server, a `ALLOW_DEBUG_ROUTES`-gated, owner-only route in `worker.ts` that forwards to `/exchange/shock` would do it. I did not add one (not my file).
4. No new dependencies. No registrations needed (`placeOrder`/`cancelOrder` were already registered).

## 6. Lessons

1. **`portfolios.cashCents` is TOTAL cash** (free + reserved for open buys), so leaderboard equity = `cashCents + Σ holdings × last`. Buying power is lower while buys are open; ui-trading should not show `cashCents` as "available".
2. **`ex.batch.batchId` is the open batch**, equal to what the next `placeOrder` ack returns; `prints[].batchId` is the batch that cleared (one less).
3. **Depth includes pending orders** for the open batch, including the noise bot's band-edge orders, so the book can look crossed between batches. That is normal in a batch auction; it clears at the next batch.
4. **Bots quote into the new batch id**, so they never get earlier-batch time priority over players at the same price.
5. **A halted round** (INVARIANT) ends with `status: 'done'`, empty standings, and no winner; the next round wipes all accounts.
6. **Testing DO code in Vitest:** keep the logic synchronous over a `{ exec(sql, ...binds).toArray() }` interface and back it with `node:sqlite` (Node 24, no flag). `deepspace/worker` imports fine in Node once `globalThis.WebSocketRequestResponsePair` exists; a fake `state.storage` with `sql`, `transactionSync`, `getAlarm/setAlarm` runs the real room class. Remember the runtime clears an alarm when it fires.
7. **Reading records in e2e:** open `/ws/app:${APP_ID}?token=…` from the page and send `{ type: 'core.subscribe', payload: { subscriptionId, query: { collection, where, limit } } }`; the reply is `core.query_result` with RBAC applied (see `query()` in api.spec.ts). Default query limit is 50.
8. **`.dev.vars` beats process env** in the Cloudflare vite plugin (see §5.2).

## 7. Branch and commit

`agent/exchange-runtime`. Review round 2 code at `cff53c1` (round 1 `88fc4c1`, first pass `18a8152`); this report is updated in the commit right after it (the branch head). Rebased on `ef0403b`; `agent/exchange` has since gained `b19953a` (PROGRESS only), so no conflicts are expected.

## 8. Review round 1 fixes

- **F1 (e2e depended on the round phase).**
  - `exchangeSnapshot` now returns `phaseEndsAt`.
  - New `liveSnapshot(minLeftMs)`: if the round is in its break, or has less than `minLeftMs` left, it waits until `phaseEndsAt + 1 s` and snapshots again. It waits through at most one round end and one full break.
  - Each signed-in exchange test runs its scenario through `inOneRound`. A scenario reports a rollover if any order gets `round_closed`, if a re-snapshot shows another `roundId` or the break, or if the pair's batch did not clear while its round was still live (`clearedInRound`). It then runs once more in the next round.
  - Test timeouts are `ROUND_BREAK_MS + 2 min` (plus 2 min for the two-user tests).
  - Run 1 of the three hit the break (the server log shows `[news] skipped round_closed`) and still passed.
- **F2 (mirror dropped rows after 5 failures).**
  - Rows are never dropped. A failed row is retried after `BATCH_MS * 2^min(attempts, 6)` (1, 2, 4 … 64 s), with a `console.warn` per failure. The cap stays at 40 writes per tick.
  - A rewrite of a row that is backing off keeps its backoff, so an outage is not hammered.
  - The alarm stays armed while rows are queued, even when the room is idle, and is set to the earliest due row.
  - Schema: the `mirror` table has a new `nextAt` column. `createTables` adds it to a table made before this change and keeps the queued rows (core.test `schema upgrade`).
  - Tests:
    - core.test: a writer fails 8 times per row; the gaps are exactly 1, 2, 4, 8, 16, 32, 64, 64 s, and nothing is sent before a row is due. Then it succeeds, and the round's `done` record and the trader's fill are both delivered (the fill written as the trader). The queue ends empty.
    - room.test: RecordRoom returns 503 for 7 minutes, through round end, the break, and the idle pause. Nothing is written in that time, warnings reach attempt 6 or more, and the alarm stays armed while idle. After recovery, alarms deliver the `done` round, the order, and the fill. The `mirror` table ends empty and the alarm stops.
- **F3 (retry test never retried).** Replaced it with a real retry. One batch runs, then a writer rejects the fill once and accepts it on the next flush. The writer saw the same `${orderId}:${batchId}` recordId both times, and the queue is empty afterwards.
- **F4:** no action needed. **Contract:** `bad_request` was approved; contracts.ts was not touched.
- **Checks on the final code:**
  - `npx tsc --noEmit`: exit 0.
  - `npm run lint`: exit 0.
  - Unit (`test run unit --port 5186`): 228 of 228 passed.
  - E2E (`test run --port 5186`) ×3: 21 passed and 1 skipped each time, all exit 0.

## 9. Review round 2 fixes

- **F1 (a shock-first wake never went idle).**
  - The bug: when a fresh room's first wake was `POST /exchange/shock`, `wake(now, false)` opened a round without writing `lastActivityAt`. `isIdle` then compared against `NaN`, so the room never idled, and bots and the mirror ran forever with no sockets.
  - Both sides are fixed:
    - `wake` now writes `lastActivityAt` whenever it creates meta, whatever woke it.
    - `isIdle` treats a missing or non-finite value as 0 (long ago).
  - Tests (core.test `shock-first wake`): one covers a shock-first wake with no sockets and no orders. It is live, not idle at `IDLE_PAUSE_MS - 1`, idle at `IDLE_PAUSE_MS`, and then its only wake is the round end. The other covers a deleted `lastActivityAt` counting as idle, but not with a socket open. Both tests fail on the round-1 code and pass now.
- **F2 (doc).** The e2e suite assumes the default round durations (`ROUND_LIVE_MS` 15 min, `ROUND_BREAK_MS` 2 min): no `EXCHANGE_ROUND_LIVE_MS` / `EXCHANGE_ROUND_BREAK_MS` overrides in `.dev.vars`. This is stated in a comment at the top of the exchange section of `tests/api.spec.ts`. The timeouts are sized from `ROUND_BREAK_MS`, and the two-user test needs a live round with at least 60 s left.
- **Checks on the final code:**
  - `npx tsc --noEmit`: exit 0.
  - `npm run lint`: exit 0.
  - Unit (`test run unit --port 5186`): 230 of 230 passed.
  - E2E (`test run --port 5186`) ×2: 21 passed and 1 skipped each time, all exit 0.
  - `.dev.vars` had no `EXCHANGE_ROUND_*` lines.
