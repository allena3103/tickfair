# Report: market-sim

## 1. Built and verified

All checks were run on commit `515b15b` (the code commit; this report is committed on top of it and changes no code).

| Item | Proof | Result |
|------|-------|--------|
| `createRng(seed)`: xmur3 → sfc32. `next()` is in [0,1). `int(lo, hi)` is inclusive at both ends and throws on a bad range. | `market.test.ts` › createRng (4 tests): the same seed gives an identical 1000-step sequence, different seeds differ, both ends of the range are hit, a bad range throws | pass |
| `INITIAL_PRICES` (ORBT 12000, CURA 4500, VOLT 8000), `initialFundamentals()` | used by the tests below | pass |
| `stepFundamental(f, rng, walkBps = WALK_BPS)`: ±4 bps random walk, and a ramp that moves 1/rampLeft of the remaining gap each step | "reaches the +600 bps target in exactly 15 steps with no noise": not within 1 cent at steps 1–14, exact (12720) at step 15, `rampLeft` 0, then stays put | pass |
| Noise is added to value and target alike, so a ramp still lands exactly | "noise does not change the remaining ramp gap" | pass |
| `applyShock(f, deltaBps, rampBatches)`: compounds on the current target, restarts the ramp, clamps at $1, validates its inputs | stacking test (+500 twice → 11025), floor clamp, RangeError on a ramp of 0 or 2.5 and on a NaN delta | pass |
| The walk can't drift a price under $1 in one round | worst-case rng (every step down) for 900 batches: every ticker stays above 60% of its start. Worst case plus a −800 bps shock every 60 batches: never below `MIN_PRICE_CENTS` (100) | pass |
| Values are always integer cents | 500 steps with shocks | pass |
| `drawNewsEvent(rng)`: minor 100–200 bps, major 400–800 bps (25% chance), ramp 10–20, **`deltaBps` signed = direction × magnitude** | 10,000 draws all in bounds, the sign matches `direction`, all 3 tickers appear, majors 20–30%, ups 45–55%. Deterministic per seed. | pass |
| `marketMakerQuotes`: estimate closes 20–30% of the gap each batch (at least 1 cent). Spread 20–60 bps, size 50–200, inventory skew of 10 bps per 100 shares (capped at 200 bps). Quotes are clamped into the band of `last`. | 2,000 batches with random shocks and inventories: bid < ask whenever both are quoted, both quotes in band, sizes in range, spread in range | pass |
| Skew direction | inventory +1000 → bid and ask both lower than flat; −1000 → both higher | pass |
| Lag, then convergence | +600 bps shock ramped over 15 batches: gap > 100 cents at batch 5 (the skill window), < 0.5% at batch 20, ≤ 15 cents at batch 25 | pass |
| When the estimate is outside the band, it quotes one side at the band edge (never self-crosses) | estimate 20000 vs last 12000 → a single buy at `bandFor(12000).hi` | pass |
| Pure: doesn't mutate its input state. Deterministic per seed. | 2 tests | pass |
| `noiseTraderOrders`: ~30% per ticker per batch, 1–50 shares, random side, limit at the band edge (buy = hi, sell = lo) | 5,000 batches with random `last`: every order is inside ±10% of last, the rate is between 27% and 33%. Invalid `last` (0, NaN, negative) is skipped. Deterministic. | pass |
| Header comment on why the maker lags | `src/engine/market/bots.ts` lines 1–12 | present |
| Imports only from `src/shared/contracts.ts` (plus local files and vitest) | `grep "from '" src/engine/market/*.ts` | confirmed |

Commands and results:

```
$ npx tsc --noEmit
exit 0

$ npm run lint        (eslint .)
exit 0

$ npx deepspace test run unit --port 5183
 Test Files  5 passed (5)
      Tests  43 passed (43)        # 23 of these are src/engine/market/market.test.ts
exit 0
```

## 2. Built but unverified

- Behaviour inside the real batch loop (fills against live quotes, how big the skill window is in practice). That needs exchange-runtime and is out of my scope.

## 3. Not built or cut

- e2e: not run. Task 02 sets port 5183 for unit tests only, and I own no Playwright specs, so I didn't start a dev server or use any test accounts.

## 4. Files changed

All are inside `src/engine/market/**`, which I own:
`rng.ts`, `fundamental.ts`, `news.ts`, `bots.ts`, `index.ts`, `market.test.ts`. Plus this report.

## 5. Requests for the director

No contract changes or dependencies are needed. Notes for exchange-runtime and news:

1. **`NewsDraw.deltaBps` is signed** (`direction × magnitude`), so news can pass it straight to `/exchange/shock`, and `applyShock` takes it as is. Please confirm this reading of the contract, which doesn't say whether the field is signed.
2. **`BotState.inventory` is signed shares relative to the maker's neutral position.** The runtime must update it from `bot:mm` fills. `marketMakerQuotes` only carries it through and never changes it.
3. **Long-only rule (D4) vs bots:** the maker quotes asks and the noise trader sells, so the bot accounts need seeded shares and cash, or their sells get `insufficient_shares`. Quote sizes are 50–200, so a modest share seed with skew should keep it from running dry. If the runtime doesn't want to seed shares, it can drop sell intents the bot can't cover.
4. **Rng draw order is fixed:** per batch, `stepFundamental` × 3 (in TICKERS order), then `marketMakerQuotes`, then `noiseTraderOrders`. Each makes the same number of draws every call whatever the outcome, so replays from the round seed are exact as long as the runtime calls them in a fixed order with one rng. Using a separate rng for news (e.g. `createRng(roundId + ':news')`) keeps cron timing from changing the batch sequence.
5. Extra exports the runtime may find handy: `initialFundamentals()`, `initialBotState()`, `bandFor(last)` (inclusive band rounded inward), `MM_BOT_ID = 'bot:mm'`, `NOISE_BOT_ID = 'bot:noise'`, `MIN_PRICE_CENTS`.
6. The ±10% band I check against is `ceil(last×0.9)`…`floor(last×1.1)`, both ends inclusive. If engine-core's band check is exclusive at the edges, noise orders at the edge would be rejected as `outside_band`. Please confirm this against engine-core at merge.

## 6. Lessons

- A bash heredoc holding several TypeScript files failed to parse in this harness ("unexpected EOF while looking for matching `'`"). Use the Write tool for source files.
- Spread assertions in whole cents need about 2 cents of slack, because floor(bid) and ceil(ask) each widen the spread. On a low-priced ticker that's more than 6 bps.
- Make every bot draw its random values unconditionally. Otherwise the rng sequence depends on outcomes (fire/skip), and replays drift.

## 7. Branch and commit

Branch `agent/market-sim`. Code commit `515b15b`. The report commit is the branch head (see `git log -1`).

---

# Round 2: slow-test fix (director request)

Rebased `agent/market-sim` onto `agent/exchange` (head `9cb2f8d`, which already contained my merged code and engine-core). No conflicts. Fix commit: `0b797b4`. Only `src/engine/market/market.test.ts` changed. No source changes.

## Cause

The work being tested is trivial: 10,000 news draws take microseconds. Almost all of the time went to **per-iteration `expect()` calls** inside hot loops. That was about 90k matcher calls in the news test, about 70k in the market-maker test, about 40k in the noise test, and 50k in the rng range test. Each matcher call builds an assertion object, and that cost grows under load.

## Fix

- In every hot loop, plain boolean checks collect violations into a `bad` array, which is asserted once with `expect(bad).toEqual([])`. A failure still names the offending batch, ticker, and values. The same change was made to 3 smaller loops (the identical-sequence, $1-floor, and integer-cents tests).
- **Iteration counts are unchanged** (10,000 draws, 2,000 MM batches, 5,000 noise batches, 10,000 rng draws), so every property is as strong as before. No per-test timeouts were needed.
- Added a non-vacuity guard to the MM test: more than 5,000 two-sided quotes must be seen.
- Mutation check, run and then reverted: noise buy limit set to `band.hi + 1`, and CURA ask forced equal to bid. Result: 3 tests failed (MM bounds, MM skew, noise band), as expected. `bots.ts` was restored, and `git status` showed only the test file changed.

## Per-test timings, file run alone (vitest --reporter=verbose)

| Test | Before | After |
|------|--------|-------|
| int() covers both inclusive ends | 934ms | <10ms |
| 10,000 news draws | 2287ms | 15ms |
| MM bid < ask, in band | 2024ms | 19ms |
| noise within band | 828ms | 12ms |
| whole file (tests) | 6.19s | 0.23s |

## Checks on `0b797b4`

```
$ npx tsc --noEmit          → exit 0
$ npm run lint              → exit 0

$ npx deepspace test run unit --port 5183   (3 runs in a row; the CLI prints totals only)
run 1: Test Files 8 passed (8), Tests 85 passed (85), Duration 17.80s, exit 0
run 2: Test Files 8 passed (8), Tests 85 passed (85), Duration 18.75s, exit 0
run 3: Test Files 8 passed (8), Tests 85 passed (85), Duration 17.07s, exit 0
```

The CLI doesn't print per-file durations, so I ran the same full suite 3 more times with `npx vitest run --reporter=json` (the same vitest config, all 8 files in parallel) and read each file's duration:

| Run | market.test.ts | (for comparison) engine/core/property.test.ts |
|-----|----------------|-----------------------------------------------|
| 1 | 0.15s | 18.65s |
| 2 | 0.16s | 18.61s |
| 3 | 0.21s | 18.58s |

## Note for the director

- `src/engine/core/property.test.ts` (engine-core) now takes about 18.6s under the full suite. It sets the total unit duration and is the main source of the CPU load that pushed my file past 5s. I didn't touch it, because it isn't mine. If it uses per-iteration `expect()` in its property loops, the same fix probably applies.
- Lesson for later workers: in property-style loops, collect violations and assert once. Don't call `expect()` per iteration.

---

# Round 3: reviewer finding (ramp bounds checked against the code's own constant)

- `drawNewsEvent` loop: the ramp check now uses the spec literals `rampBatches >= 10 && <= 20` again, instead of `RAMP_BATCHES.lo/hi`.
- Same weakness, also fixed: the size bounds in that loop use `MINOR_BPS`/`MAJOR_BPS`. Before the loop, the test now asserts once that `MINOR_BPS` is `{ lo: 100, hi: 200 }` and `MAJOR_BPS` is `{ lo: 400, hi: 800 }`. A change to the constants now fails the test instead of silently widening what it accepts.
- Only `src/engine/market/market.test.ts` changed.

```
$ npx tsc --noEmit                          → exit 0
$ npm run lint                              → exit 0
$ npx deepspace test run unit --port 5183   → Test Files 8 passed (8), Tests 85 passed (85), Duration 36.50s, exit 0
```

The 36.5s total (17–19s in round 2) reflects machine load from parallel workers. The market file's work is unchanged apart from two cheap asserts.
