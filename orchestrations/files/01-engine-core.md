# Task 01: engine-core (Wave 1, pure module, money path)

- Worktree: `C:/DeepSpace-project-engine-core`, branch `agent/engine-core`, port 5182 (unit tests only).
- Read first: `BRIEF.md`, `PLAN.md` §3 "Batch clearing", §4 invariants.

## Owns

`src/engine/core/**`, including its `*.test.ts`.

## Out of scope

Durable Objects, SQLite, network, bots, UI. The module must not import from `deepspace` or `cloudflare:*`. Import only from `src/shared/contracts.ts` and `@noble/hashes`.

## API to implement (exported from `src/engine/core/index.ts`)

```ts
export interface BookOrder { orderId: string; traderId: string; ticker: Ticker; side: Side; limitCents: number; remaining: number; batchId: number }
export interface Fill { orderId: string; traderId: string; ticker: Ticker; side: Side; qty: number; priceCents: number; batchId: number }
export interface ClearResult { ticker: Ticker; batchId: number; clearCents: number | null; volume: number; seed: string; fills: Fill[] }

export function batchSeed(roundId: string, ticker: Ticker, batchId: number, orderIds: string[]): string   // hex SHA-256 of `${roundId}|${ticker}|${batchId}|${sorted ids joined by ','}`
export function clearingPrice(orders: BookOrder[], lastCents: number): { clearCents: number; volume: number } | null
export function clearBatch(input: { roundId: string; ticker: Ticker; batchId: number; lastCents: number; orders: BookOrder[] }): ClearResult

export interface Account { cashCents: number; reservedCents: number; holdings: Record<Ticker, { qty: number; reservedQty: number }> }
export function checkAndReserve(acct: Account, order: { side: Side; ticker: Ticker; qty: number; limitCents: number }, ctx: { lastCents: number; openOrders: BookOrder[] }): { ok: true; acct: Account } | { ok: false; code: RejectCode }
export function settleFill(acct: Account, fill: Fill, orderLimitCents: number): Account     // buyer refund of (limit - price) * qty
export function releaseOrder(acct: Account, order: BookOrder): Account                       // cancel / round end
export function marketLimit(side: Side, lastCents: number): number                            // band edge
```

All functions are pure and synchronous, and return new objects.

## Rules to implement

- **Clearing price.** Candidates are the distinct limit prices. Maximize V(p) = min(D(p), S(p)). Break ties by min |D−S|, then min |p − lastCents|, then the lower p. If there is no cross, return `null`.
- **Allocation.** Orders priced strictly better than p fill in full. Rationing happens at exactly p on the side with excess:
  - earlier `batchId` first;
  - within the same batch, pro-rata by `remaining`, with whole shares assigned by largest remainder;
  - leftover-share ties go to the lowest `sha256(seed + orderId)`.
  - *Director-approved edge case:* the tie-breaks can pick a price p where the orders priced strictly better than p, on the side with excess, already exceed the other side. For example, buys of 6 and 4 at 105 against a sell of 5 at 100, with last = 100, gives p = 100. Price priority still holds: that better level is rationed by the same rules (earlier batch, then pro-rata, then the seed tiebreak), and orders at p get nothing.
- **Account meaning (director-approved):** `cashCents` is free cash; money held for open buys sits in `reservedCents`. `holdings.qty` is all shares held; `reservedQty` is the part held for open sells. The band is inclusive with exact integer edges that round inward; `marketLimit` and the `outside_band` check share one band function.
- **Validation in `checkAndReserve`:**
  - integer `qty` in 1..100_000;
  - integer positive `limitCents`;
  - within ±`PRICE_BAND_BPS` of last (`outside_band`);
  - enough cash for buys (`qty*limit`) or unreserved shares for sells;
  - `self_cross` if the trader has an opposite-side open order on that ticker that would cross;
  - `too_many_open` above `MAX_OPEN_ORDERS`.

## Tests (Vitest, deterministic)

- Hand-worked cases:
  - simple cross;
  - no cross;
  - tie-breaking at each level;
  - one buyer vs. two identical simultaneous sellers (even split);
  - 3 shares across 2 equal orders (largest remainder + seed tiebreak, with the expected winner computed by hand);
  - an earlier batch beating a later one at the same price;
  - market orders clamped to the band.
- Reserve, settle, and release round trips, including buyer refunds.
- **Property tests** over a seeded random order stream (≥ 1,000 batches). Use a hand-rolled seeded generator; adding fast-check is a director request.
  - cash + shares are conserved across all accounts per batch;
  - no negative cash, qty, or reserved amounts;
  - fills never exceed `remaining`;
  - buy fill price ≤ limit and sell fill price ≥ limit;
  - every fill in a batch has the same price.
- Reproducibility: the same input gives the same `ClearResult`, including the seed.

## Acceptance

- [ ] `npx deepspace test run unit` passes. Paste the counts.
- [ ] No imports outside `src/shared/contracts.ts` and `@noble/hashes`.
- [ ] A short header comment in `clear.ts` explains the auction rules in plain words, for the writeup.
- [ ] Final report per `BRIEF.md`.
