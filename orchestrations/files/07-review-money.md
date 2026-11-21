# Task 07: review-money (Wave 2b, READ-ONLY independent review)

- Worktree: `C:/DeepSpace-project-review`, detached at the `agent/exchange` commit the director names. **Make no edits and no commits.**
- Read first: `BRIEF.md`, `PLAN.md` §2–§4, §10.

## Scope

`src/engine/core/**`, `src/engine/market/**` (only how bots go through the reserve path), `src/server/exchange-room.ts`, `src/server/exchange/**`, `src/actions/orders.ts`, `src/actions/news.ts`, `src/schemas/**`, `src/server/realtime-routes.ts`.

## Report only issues that affect correctness or a stated requirement

1. **Money.** Can cash, reserved cash, shares, or reserved shares go negative? Can value be created or destroyed? Can a fill be applied twice, for example on an alarm retry or a duplicate mirror? Are buyer refunds correct?
2. **Fairness.** Does the arrival order within one batch affect the outcome in any way? Is the allocation reproducible from the published seed? Do bots get any advantage players don't?
3. **Identity and authorization.** Is any userId taken from client input? Is any ExchangeRoom endpoint reachable without the DO stub? Can a client write any exchange collection? Can a non-owner trigger a paid LLM call (`breakingNews`, cron trigger)?
4. **Data leaks.** Does depth, the WS stream, or any record expose another user's open orders or the impact size of a news event? Does any action return raw `users` rows?
5. **Concurrency.** Is there any `await` inside the critical section of the batch? Can the intake interleave with clearing in a way that breaks the invariants?

For each finding, give `file:line`, a concrete failing scenario (inputs, then the wrong result), severity (blocker / major / minor), and the smallest correct fix. Don't include style notes or speculative "consider" items. If something can't be grounded in the source, leave it out.

## Acceptance

- [ ] A findings list, or an explicit "no blocking findings" for each of the 5 areas, with the evidence checked.
