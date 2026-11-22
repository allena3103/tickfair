# Task 03: news (Wave 1)

- Worktree: `C:/DeepSpace-project-news`, branch `agent/news`, port **5184**.
- Read first: `BRIEF.md`, `PLAN.md` §6, §10. Docs: `/guides/scheduled-jobs.md`, `/guides/external-apis.md`, `/guides/server-actions.md`. Read `orchestrations/files/SPIKE.md` §S4 for the LLM schema.

## Owns

`src/cron.ts`, `src/integrations.ts`, `src/server/news/**`, `src/actions/news.ts`, `tests/api.spec.ts`.

## Out of scope

The shock's effect on prices (exchange-runtime), news UI (ui-shell), and `src/engine/market/**`. `NewsDraw` is in `src/shared/contracts.ts`. market-sim is building `createRng` and `drawNewsEvent` in parallel with you, so build the pipeline with the draw **injected** (generate and publish take a `NewsDraw`). Leave the cron's call to `drawNewsEvent` for last. When the director tells you market-sim is merged, rebase onto `agent/exchange`, import `createRng` and `drawNewsEvent` from `src/engine/market`, finish the cron wiring, then run your final checks. Don't reimplement them.

## Steps

1. **Pipeline.** In `src/server/news/generate.ts`: `generateNews(draw: NewsDraw, deps: { callLLM, now })`.
   - Build a prompt with the fictional company, its sector, the direction, and the size.
   - Require strict JSON `{headline, body}`.
   - Validate: JSON parses; `headline` is ≤ 90 characters; `body` is ≤ 2 sentences and ≤ 280 characters; there are no real-company or real-ticker mentions (a denylist plus a check that only the 3 in-game names appear); the tone matches the direction (ask the model for a `"sentiment"` field and compare it).
   - Return a `NewsItem` or a typed failure.
   - `callLLM` wraps `anthropic/chat-completion` with model `claude-haiku-4-5`, a small `max_tokens`, and low temperature.
2. **Publishing.** In `src/server/news/publish.ts`:
   - write the `news` record (recordId = server-generated `newsId`);
   - **then** POST `/exchange/shock` to the ExchangeRoom stub with `{newsId, ticker, deltaBps, rampBatches}`;
   - if generation or validation fails, log `[news] skipped <reason>` and **do not shock** (fail closed).
3. **Cron.** In `src/cron.ts`, add a `news` task with `intervalMinutes: 1`.
   - A run fires with probability 0.5, drawn from an RNG seeded per minute.
   - It only fires when the current round is `live`: read the `rounds` collection, or note that the shock endpoint returns `round_closed`.
   - Use `buildCronContext(..., \`app:${env.DEEPSPACE_APP_ID}\`)`.
4. **Billing.** In `src/integrations.ts`: `anthropic: { billing: 'developer' }`. Leave existing entries as they are.
5. **Owner-only demo action.** In `src/actions/news.ts`, add `breakingNews`: gated on `env.OWNER_USER_ID === ctx.userId`, otherwise it returns `forbidden`. Rate-limit it to 1 call per 10s. It runs the same pipeline. Ask the director to register it in `src/actions/index.ts`.
6. **Cron monitor lockdown.** Follow PLAN §10 and the scheduled-jobs doc: only admins may trigger, pause, or resume cron. That role resolver lives in `src/server/realtime-routes.ts`, which you don't own, so send the director the exact diff.

## Tests

- **Unit** (`src/server/news/*.test.ts`), with an injected fake `callLLM`:
  - valid reply → `NewsItem`;
  - invalid JSON, a headline that's too long, a real ticker mentioned, or the wrong sentiment → skipped;
  - when the reply is invalid, the shock is never sent (assert that the injected shock function was not called).
- **`tests/api.spec.ts`:**
  - `breakingNews` unauthenticated → 401;
  - as a non-owner test account → `forbidden`.
  Mock the Anthropic boundary in any e2e that would reach it.
- **One real call**, with the director's go-ahead only: trigger the `news` task locally, then paste the produced headline and log line.

## Acceptance

- [ ] Unit tests and `test run --port 5184` (smoke + api) pass.
- [ ] Locally, a triggered `news` task produces a `news` record visible via `useQuery('news')` (screenshot or query output), or a logged skip with its reason.
- [ ] No client path can trigger a paid call. List every caller of `callLLM` in the report.
- [ ] Final report per `BRIEF.md`.
