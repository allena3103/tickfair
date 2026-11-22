# Task 05: exchange-runtime (Wave 2, money path)

- Worktree: `C:/DeepSpace-project-exchange-runtime`, branch `agent/exchange-runtime` (from `agent/exchange` after wave 1 merged), port **5186**.
- Read first: `BRIEF.md`, `PLAN.md` §3–§7, §10. `orchestrations/files/SPIKE.md` (especially the S3 mirror recommendation) and `LESSONS.md`. The APIs of `src/engine/core` and `src/engine/market`.

## Owns

`src/server/exchange-room.ts`, `src/server/exchange/**`, `src/actions/orders.ts`, `tests/api.spec.ts`.

## Out of scope

Changing `src/engine/**`: report bugs to the director, who routes them. Also out of scope: UI, news generation, and schemas (request schema changes from the director).

## Steps

1. **SQLite tables** in ExchangeRoom: `meta`, `accounts`, `holdings`, `book`, `batches`, `fundamentals`, `bots` (PLAN §4). Create them on first construct.
2. **Intake** (`POST /exchange/order|cancel`):
   - enroll the trader on first action in a round with `START_CASH_CENTS`;
   - enforce `MAX_ORDERS_PER_BATCH`;
   - call `checkAndReserve`;
   - persist with the server `orderId` and the current `batchId`;
   - return `PlaceOrderData`.
   Cancel releases the reservation for any unfilled quantity. Non-owners get `not_owner`, and already filled or cancelled orders get `already_final`.
3. **Batch loop** (`onAlarm`, every `BATCH_MS` while `phase === 'live'`):
   1. compute seeds;
   2. in **one `transactionSync`**: `clearBatch` per ticker, then `settleFill`, then update the book, last price, and fundamentals (`stepFundamental`), then run bots (cancel old quotes, add new intents through the **same** reserve path, with bot ids `bot:mm` and `bot:noise`), then increment `batchId`;
   3. after commit: broadcast `ex.batch`, then mirror.
   - The alarm only re-arms while there's a live round. It pauses when the room has had no sockets and no orders for 5 min, and resumes on the next request or connection.
4. **Mirror to RecordRoom**, using the S3 mechanism with deterministic recordIds from the BRIEF table:
   - changed `orders`, new `fills`, the `tape` (one record per ticker with volume > 0), changed `portfolios`, and `tickers.lastCents`;
   - bots get no `orders` or `fills` mirrors;
   - writes are idempotent, so a retried alarm can't duplicate anything;
   - if S3 says to throttle, mirror per-user records every batch and `tickers` every N batches, and document the choice.
5. **Shock** (`POST /exchange/shock`): `applyShock`, starting from the next batch. Returns `round_closed` during the break.
6. **Rounds.** Lifecycle `live` (15 min) then `break` (2 min):
   - **at the start of a round:** new `roundId`; reset fundamentals and bots; **seed bot accounts** (`bot:mm`, `bot:noise`) with cash and shares so long-only bots can sell (LESSONS 11); **write the `rounds` record with `status: 'live'`, `startsAt`, `endsAt` immediately** (news's cron and ui-shell's `useCurrentRound` find the live round from it); write/refresh the 3 `tickers` records (`lastCents`, `openCents`); human accounts enroll lazily;
   - **at the end of a round:** cancel all orders, release reservations, mark to market, update the `rounds` record to `status: 'done'` with standings and the winner (bots excluded; `winnerId` is always a human or the field is empty), broadcast `ex.phase`;
   - **first start and idle resume:** if no round exists when the room wakes (first order, first socket, or shock), start one. If the room wakes from an idle pause after `phaseEndsAt` has passed, close the stale round properly (step above), then start the next one. Never leave a `rounds` record stuck at `live`.
   - **durations:** read `ROUND_LIVE_MS` and `ROUND_BREAK_MS` from the contracts, but allow the optional env vars `EXCHANGE_ROUND_LIVE_MS` and `EXCHANGE_ROUND_BREAK_MS` to override them. They're only set for local test and evaluation runs, so a round rollover can be exercised in about a minute. Document both in the report. Nothing else may be configurable.
   - **market-maker inventory:** update `BotState.inventory` from the market maker's fills every batch (LESSONS 12). Clamp every bot intent with engine-core's band function before reserving it. A rejected bot intent is logged and skipped; it never halts a batch (LESSONS 15).
   - **`rate_limited`:** enforce `MAX_ORDERS_PER_BATCH` per trader per batch here (engine-core doesn't).
7. **WS.** Send `ex.snapshot` on connect, `ex.batch` per batch, and `ex.phase` on transitions. Depth shows the top 10 levels aggregated, with no trader ids.
8. **Self-check.** After every batch, assert the PLAN §4 invariants on touched accounts. On a violation, log `[exchange] INVARIANT <detail>` at error level and halt the round. Failing loud beats corrupting balances.
9. **`src/actions/orders.ts`.** Finalize param validation (types and ranges) before the DO call. The DO stays the authority.

## Tests

- **`tests/api.spec.ts`** (extend; keep news's tests):
  - unauthenticated `placeOrder` → 401;
  - bad qty, price, or ticker → typed errors;
  - insufficient cash;
  - cancel another user's order → `not_owner`;
  - a valid order returns `orderId` and `batchId`.
- **Two-user API test:** A buys and B sells at a crossing price within the same batch. After one batch, both have `fills` at the same price, both `portfolios` have changed, and a `tape` record exists.
- **Simultaneous fairness (end-to-end):** A and B send identical marketable buys in the same batch. Assert that both acks have the same `batchId` and that every fill in that batch has one price. The exact pro-rata split is proven in engine-core's unit tests. Bots also trade, so e2e can't pin exact quantities; don't add a bot kill switch to force it.

## Acceptance

- [ ] `test run unit` + `test run --port 5186` pass.
- [ ] Manual local run, `dev start --port 5186`, signed in as one user for 2 minutes:
  - bots keep the tape moving;
  - a buy fills;
  - the portfolio record updates;
  - a POST to `/exchange/shock` via `breakingNews` (the owner account) moves the price over ~15 batches.
  Report the observed numbers.
- [ ] No `INVARIANT` lines in logs during the run.
- [ ] Final report per `BRIEF.md`.

## Director decisions made during the build

- **No paid LLM calls** in the manual run or tests (user decision; see `NEWS_LLM_IN_DEV`). The price-shock check runs as an integration test that posts to the real `ExchangeRoom` fetch entry with a fixed `deltaBps`, instead of on a running dev server through `breakingNews`. Approved.
- **A malformed `/exchange/shock` body returns HTTP 400 with code `bad_request`.** This is approved and added to the shock response contract.
- **Round-length overrides** (`EXCHANGE_ROUND_LIVE_MS`, `EXCHANGE_ROUND_BREAK_MS`) reach the local worker only through lines appended to `.dev.vars` after `dev start`. They must never be committed. The builder's report documents this.
- **`portfolios.cashCents` is total cash**, including cash reserved for open buys. Equity = cashCents + Σ qty × last.
