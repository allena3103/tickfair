# Report: engine-core

## 1. Built and verified

All checks below ran on the final code commit `d254e90` in `C:/DeepSpace-project-engine-core`.

| Item | Proof | Result |
|------|-------|--------|
| Typecheck | `npx tsc --noEmit` | exit 0, no output |
| Lint | `npm run lint` (`eslint .`) | exit 0, no findings |
| Unit suite (whole repo) | `npx deepspace test run unit --port 5182`, run 3 times in a row | each run: `Test Files 7 passed (7)`, `Tests 62 passed (62)` |
| engine-core tests only | `npx vitest run src/engine/core` | `Test Files 3 passed (3)`, `Tests 42 passed (42)` |
| Import restriction | `grep "from '" src/engine/core/*.ts` | non-test code imports only `../../shared/contracts`, `@noble/hashes/sha2.js`, `@noble/hashes/utils.js`. Test files also import `vitest`. Nothing from `deepspace` or `cloudflare:*`. |
| `batchSeed` format | `clear.test.ts` "batchSeed": the expected value was computed separately with `node:crypto` | pass |
| Clearing price + all 4 tie-break levels (volume, \|D−S\|, distance to last, lower price), no cross, empty or one-sided book | `clear.test.ts` | pass |
| One buyer vs. two identical sellers (5/5) | `clear.test.ts` | pass |
| 3 shares across 2 equal orders | `clear.test.ts`. Worked by hand: seed `5323…6700`, `sha256(seed+'s1')=d4f1…`, `sha256(seed+'s2')=a2bb…`, so s2 gets the leftover share (s1=1, s2=2). The values came from `node:crypto`. | pass |
| Largest remainder wins before the hash tiebreak | `clear.test.ts` (4:2 split of 5 gives 3/2) | pass |
| Earlier batch beats a later one; earlier batch fills in full, then the later batch is pro-rated; better price beats an earlier batch | `clear.test.ts` | pass |
| Market orders clamped to the band edge, reserved at the edge, refunded at clear | `accounts.test.ts` | pass |
| **Inclusive band (director note)**: exact edges `last*(1±10%)` are accepted. For every last in 1..20000, `marketLimit` edges are accepted, edge ±1 cent gets `outside_band`, and edges are the true edges rounded inward | `accounts.test.ts` "band is inclusive…" and "for every last price 1..20000…" | pass |
| Validation codes: invalid_qty (0, −1, 1.5, NaN, 100001), invalid_price, invalid_ticker, invalid_side, outside_band, insufficient_cash/shares (incl. already-reserved), self_cross (both sides, and the non-crossing cases), too_many_open at 20 | `accounts.test.ts` | pass |
| Reserve → settle → release round trips with buyer refund, partial fill + cancel, sell partial + release, reserve+release is an exact no-op, and invariant breaches throw | `accounts.test.ts` | pass |
| Property tests: seeded mulberry32 stream, 8 traders, 3 tickers, 1,200 batches (seed 1) + 600 batches (seed 20261121) + a reproducibility run. Checked after every batch: total cash and shares conserved (also across cancels and round-end release); no negative cash/reserved/qty; `qty ≥ reservedQty`; reservations equal exactly what the open book holds; fill ≤ remaining; buy price ≤ limit, sell price ≥ limit; one uniform price per batch; buy volume = sell volume = `volume`; volume is the max over **every integer price** (brute force); the remaining book does not cross; shuffled input gives an identical `ClearResult` | `property.test.ts` | pass (seed 1: >500 clears, >2,000 fills, some rejects, all asserted) |
| Tests catch bugs | Mutation checks, then reverted: removing the buyer refund fails "conservation at batch 3"; reversing batch priority fails 2 allocation tests | confirmed |
| Header comment explaining the auction in plain words | top of `src/engine/core/clear.ts` | present |

## 2. Built but unverified

Nothing. This is a pure module, and the task needs no e2e. I own no Playwright specs, so I didn't run `npx deepspace test run --port 5182`. No dev server was started.

## 3. Not built or cut

- `MAX_ORDERS_PER_BATCH` / `rate_limited` is not in `checkAndReserve`. It isn't on this task's rule list, and it needs per-batch counting state that belongs in exchange-runtime.

## 4. Files changed

All are inside `src/engine/core/**`, plus this report as the task instructs:
`types.ts`, `seed.ts`, `clear.ts`, `accounts.ts`, `index.ts`, `clear.test.ts`, `accounts.test.ts`, `property.test.ts`, `orchestrations/files/reports/engine-core.md`. `src/shared/contracts.ts` was not edited.

## 5. Requests for the director

No contract or dependency changes. Two points to review and approve:

1. **Spec edge case (allocation).** The rule "orders priced strictly better than p fill in full" can't always hold with the specified tie-breaks. Example: buy 6@105, buy 4@105, sell 5@100, last 100. Candidates 100 and 105 both give V=5 and |D−S|=5, and "closest to last" picks p=100. The strictly-better buys (10) then exceed supply (5). I kept strict price priority. The marginal price level (here 105) is rationed by the same rules: batch first, then pro-rata, largest remainder, hash. This matches the task rule in every normal case. It is tested ("rare case…") and described in the `clear.ts` header. If you want a different rule, tell me.
2. **Account semantics that exchange-runtime must follow** (documented on `Account` in `types.ts`): `cashCents` is **free** cash, and reserved buy cash sits separately in `reservedCents`, so total cash = `cashCents + reservedCents`. `holdings.qty` is **all** shares, and `reservedQty` is the part of it held for sells. The `portfolios.cashCents` mirror should probably show `cashCents + reservedCents`. That's the runtime's call.

## 6. Lessons

- `checkAndReserve`'s `ctx.openOrders` must be **only this trader's** open orders (all tickers). Passing the whole book would wrongly reject with `self_cross` and `too_many_open`.
- `settleFill` needs the **order's** limit (the price it reserved at). For market orders, that's the stored `marketLimit`, which `orders.limitCents` holds anyway.
- `Fill.batchId` is the batch being cleared, not the order's arrival batch. This matches the `fills` recordId `${orderId}:${batchId}`.
- `settleFill`, `releaseOrder`, and `clearBatch` **throw** on invariant breaches or malformed input (wrong ticker, duplicate ids, non-integer remaining). Call them inside `transactionSync` so a throw rolls the batch back.
- Pass the **whole book** for the ticker to `clearBatch`, both resting and new orders. The seed covers every orderId passed, including those with `remaining=0`.
- Band edges: take them from `priceBand()` / `marketLimit()` (also exported). Don't compute `last*1.1` yourself. A non-whole-cent edge rounds inward (e.g. last 1005: hi 1105). `Math.round(1105.5)=1106` would be rejected. This matters for market-sim's edge-placing noise trader.
- Vitest's 5s default timeout plus many `expect()` calls in a loop can flake under `deepspace test run unit`, which runs files in parallel. Collect failures in plain code and assert once, or set a per-test timeout.
- Fills come back sorted (buys first, then by orderId), so results don't depend on input order.

## 7. Branch and commit

Branch `agent/engine-core`. Final code commit `d254e90`. This report is committed on top of it in the next commit.
