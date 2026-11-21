# Task 02: market-sim (Wave 1, pure module)

- Worktree: `C:/DeepSpace-project-market-sim`, branch `agent/market-sim`, port 5183 (unit tests only).
- Read first: `BRIEF.md`, `PLAN.md` §5 and §6 (shock semantics only).

## Owns

`src/engine/market/**`, including its `*.test.ts`.

## Out of scope

Matching (engine-core), DO wiring, LLM calls, UI. Import only from `src/shared/contracts.ts`. Bots output **order intents**; they never touch accounts directly.

## API to implement (exported from `src/engine/market/index.ts`)

```ts
export interface Rng { next(): number /* [0,1) */; int(lo: number, hi: number): number }
export function createRng(seed: string): Rng                                   // deterministic (e.g. sfc32/xmur3)

export interface Fundamental { valueCents: number; targetCents: number; rampLeft: number }
export const INITIAL_PRICES: Record<Ticker, number>                             // e.g. ORBT 12000, CURA 4500, VOLT 8000
export function stepFundamental(f: Fundamental, rng: Rng): Fundamental          // small random walk + move toward target while rampLeft > 0
export function applyShock(f: Fundamental, deltaBps: number, rampBatches: number): Fundamental

export interface NewsDraw { ticker: Ticker; direction: 1 | -1; size: 'minor' | 'major'; deltaBps: number; rampBatches: number }
export function drawNewsEvent(rng: Rng): NewsDraw                               // minor 100–200 bps, major 400–800 bps, ramp 10–20

export interface BotIntent { botId: string; ticker: Ticker; side: Side; qty: number; limitCents: number }
export interface BotState { estimateCents: Record<Ticker, number>; inventory: Record<Ticker, number> }
export function marketMakerQuotes(state: BotState, fundamentals: Record<Ticker, Fundamental>, last: Record<Ticker, number>, rng: Rng): { state: BotState; intents: BotIntent[] }
export function noiseTraderOrders(last: Record<Ticker, number>, rng: Rng): BotIntent[]
```

## Behaviour targets

- **Market maker.**
  - Its estimate trails the fundamental (it closes about 20–30% of the gap each batch). This lag is the window in which a player can profit from news.
  - Quotes both sides with a spread of about 20–60 bps, a size of 50–200 shares, and inventory skew (long inventory shades quotes lower).
  - Re-quotes every batch: the runtime cancels its previous quotes.
- **Noise trader.** About 30% chance per ticker per batch of a small (1–50 shares) marketable order at the band edge on a random side.
- **Fundamental walk.** Bounded so a price can't drift under $1 in one round.

## Tests (Vitest, deterministic)

- The same seed gives an identical sequence.
- After `applyShock(+600bps, ramp 15)`, the fundamental reaches the target ±1 cent in exactly 15 steps when there's no noise.
- `drawNewsEvent` stays within its bounds over 10,000 draws.
- Market maker:
  - its bid is always below its ask;
  - skew moves both quotes in the expected direction;
  - its estimate converges to a shocked fundamental within ~20 batches.
- Noise orders always fall within the price band of `last`.

## Acceptance

- [ ] `npx deepspace test run unit` passes. Paste the counts.
- [ ] No imports outside `src/shared/contracts.ts`.
- [ ] A short header comment explains why the market maker lags (the skill window), for the writeup.
- [ ] Final report per `BRIEF.md`.
