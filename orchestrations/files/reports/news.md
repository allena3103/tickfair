# News report

Worker: news · Worktree `C:/DeepSpace-project-news` · Branch `agent/news` (rebased onto `agent/exchange` at `86ca7aa`) · Port 5184

No paid LLM call was made. No credentials, tokens, or JWTs were printed or committed.

## 1. Built and verified

All checks ran on code commit `356322b`.

| Item | Proof | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit 0, no output |
| Lint | `npm run lint` (`eslint .`) | exit 0, no findings |
| Unit | `npx deepspace test run unit --port 5184` | `Test Files 7 passed (7)`, `Tests 87 passed (87)`. 46 of these are news tests in `src/server/news/news.test.ts` and `breaking-news.test.ts` |
| e2e (smoke + api) | `npx deepspace test run --port 5184`, with `breakingNews` registered in `src/actions/index.ts` **temporarily and not committed** (as the director allowed) | `12 passed (40.8s)` |
| Validation | unit tests | A valid reply becomes a `NewsItem`. Each of these is skipped with its reason: invalid or truncated JSON, a missing field, a headline over 90 characters, a body over 280 characters, 3 sentences, a real ticker (`NVDA`, `$AAPL`, `TSLA`), a real company name (`Microsoft`), an invented company (`Zentrix Corp`), the wrong company (off_topic), and the wrong or unknown sentiment. In-game tickers and common acronyms (`FDA`, `Q3`, `GPU`) pass. Decimals like "4.5%" don't count as sentence breaks |
| Fail closed | `publishNews` unit tests, with an injected `callLLM` and injected shock/write spies | On invalid JSON, a long headline, a real ticker, the wrong sentiment, or an LLM error: `shock` **not called**, `writeNews` not called, and the log starts with `[news] skipped `. A failed record write → `skipped write_failed`, and no shock is sent |
| Publish order and payload | unit test | The record is written, then the shock is sent (order asserted). The `news` record has only `roundId, ticker, headline, body, publishedAt`. A test asserts it holds no `600`, `deltaBps`, or `ramp`. The shock body is `{newsId, ticker, deltaBps, rampBatches}`, and a signed `deltaBps` (−150) passes through unchanged. A refused shock returns `published_no_shock` without throwing |
| Prompt never carries the impact size | unit test | The prompt names the company, sector, direction, and size words, and doesn't contain the bps value |
| LLM wrapper | unit test | Endpoint `anthropic/chat-completion`, `model: 'claude-haiku-4-5'`, `max_tokens: 200`, `temperature: 0.3`. Text is extracted from the Anthropic `content[]` shape, the OpenAI `choices[]` shape, `text`, a bare string, or a nested `data`. An unknown shape throws, which becomes `llm_error` |
| Cron firing rule | unit tests (`newsTick`) and real engine | An RNG draw below 0.5 fires; 0.5 or above makes no call. The seed is per minute plus a random salt (director decision 2). With the real `createRng`/`drawNewsEvent` over 200 draws, the sign of `deltaBps` equals `direction` and the magnitude is between 100 and 800 bps |
| **Cron on the real alarm, round_closed skip path** | `npx deepspace dev start --port 5184`, one request to arm the cron, then the dev log | `[news] no event this minute` / `[cron] news ok 3ms`, `[news] no event this minute` / `[cron] news ok 1ms`, `[news] skipped round_closed` / `[cron] news ok 24ms`. The skip runs the real `rounds` query against the RecordRoom (no live round exists locally), before any LLM call. The e2e run's web server also logged `[news] skipped round_closed` / `[cron] news ok 75ms` |
| `breakingNews` owner gate | unit tests and e2e | A non-owner gets `forbidden` before any work (no rate-limit read, no pipeline). An unset `OWNER_USER_ID` gives `forbidden` to everyone. A bad ticker gives `invalid_ticker`. The owner path pins the ticker. One call per 10 s is enforced in the isolate (counted before the paid call, so skipped calls count too) and also against the newest `news.publishedAt` (other isolates). `round_closed` passes through. A failed integration call reaches the pipeline as a thrown error with the integration's `code`. e2e: no auth → **401**; signed-in test account → **200 `{success:false, error:'forbidden'}`** |
| Client can't reach the paid integration | e2e (`api.spec.ts`) against the director's proxy fix `86ca7aa` | Anonymous POST `/api/integrations/anthropic/chat-completion` → **403**. Signed-in test account → **403**. The probe body is `{}`, which the api-worker's validator would refuse even if the proxy regressed, so the test itself can never bill |

**Every caller of `callLLM`** (`grep -rn "makeCallLLM\|runNewsEvent\|callLLM(" src`, excluding tests):
- `src/server/news/generate.ts:60`: `deps.callLLM(...)` inside `generateNews`, which is reached only from `publishNews`.
- `src/server/news/runtime.ts:90`: `makeCallLLM(invoke)` inside `runNewsEvent`, after the live-round check.
- `runNewsEvent` is called from exactly two places:
  - `src/cron.ts`, through `newsTick`. The cron runs as the owner via `buildCronContext(...).integrations.call`. Only admins can trigger it, per the `/ws/cron` resolver in `86ca7aa`.
  - `src/actions/news.ts`, the `breakingNews` action, gated on `env.OWNER_USER_ID === ctx.userId`. It calls `tools.integration`.
- The browser proxy refuses every owner-billed integration (403), as tested above. No client UI calls any of these.

## 2. Built but unverified

- **The full publish path against real rooms** (a `news` record visible via `useQuery('news')` plus a real `/exchange/shock`). Locally there is no live round until exchange-runtime creates rounds, and the director ruled out the paid call for now. The same code is unit-tested end to end with a mocked LLM and spy write/shock functions. The director's single real call will cover it.
- **The real `anthropic/chat-completion` response shape.** It is undocumented. `extractText` accepts the likely shapes and fails closed (`llm_error`) on anything else. If the real call logs `[news] skipped llm_error: unrecognized LLM response shape`, the shape needs adding in `llm.ts`.
- **What the ExchangeRoom does with a shock.** Today it always answers `round_closed`. That is exchange-runtime's job.
- **Rate limit across isolates when generation keeps failing.** The cross-isolate check reads the newest `news` record, so failed generations are limited only within one isolate. The action is owner-only, so the exposure is limited to the owner's own credits.

## 3. Not built or cut

- The one real LLM call: deferred to the director (decision 4).
- No news UI or price effect (out of scope: ui-shell and exchange-runtime).

## 4. Files changed

`git diff --name-only agent/exchange...HEAD`: `src/actions/news.ts`, `src/cron.ts`, `src/integrations.ts`, `src/server/news/{breaking-news.test.ts, companies.ts, generate.ts, llm.ts, news.test.ts, publish.ts, runtime.ts, tick.ts, validate.ts}`, `tests/api.spec.ts`, plus this report. All are inside my ownership list. The tests sit under `src/server/news/**`, which I own.

Temporary local edits to `src/actions/index.ts` (registration), `src/server/http-routes.ts`, and `src/server/realtime-routes.ts` (diff proposals, before `86ca7aa`) were reverted and never committed.

`src/integrations.ts` keeps `anthropic: { billing: 'developer' }`. The `serverOnly` field was dropped, per decision 1.

## 5. Requests for the director

1. **Register `breakingNews`** in `src/actions/index.ts`:
   ```ts
   import { breakingNews } from './news'
   // in actions:
   breakingNews,
   ```
   Without it, `tests/api.spec.ts › breakingNews as a non-owner is forbidden` fails (404 `Action not found`). Checked: `11 passed, 1 failed` on the committed tree, and `12 passed` with the registration.
2. **The real call**, once rounds go live: owner-trigger `news` (or call `breakingNews` as the owner), then check the `[news] published <id> <ticker>: <headline>` log line and the `news` record.
3. **The `breakingNews` result shape**, for ui-shell or anyone who calls it:
   - published: `{success:true, data:{published:true, newsId, headline, shocked}}`;
   - validation skip: `{success:true, data:{published:false, reason}}`;
   - rejections: `forbidden`, `invalid_ticker`, `rate_limited`, `round_closed`.

## 6. Lessons

- **The template's integration proxy treated every unlisted integration as owner-billed** for any signed-in user. The director has fixed this (`86ca7aa`). Integration tests should probe with a body the api-worker's validator rejects (`{}`), so a regression can't spend money.
- `deepspace dev start` really runs the CronRoom alarm locally, about once a minute after the first request arms it. Watch for `[cron] <task> ok` in the dev log; you don't need a trigger UI.
- `cron.ts`'s header comment contains `import type { CronTask }`, so a text splice keyed on that string lands inside the comment.
- `page.route` can't mock server-side integration calls (cron, actions). Inject `callLLM` in unit tests instead.
- A per-minute RNG seed made from only public inputs (minute, app id) makes news predictable. Add a server-only salt.
- `records.query` through the RecordRoom stub (`/api/tools/execute`) accepts `orderBy`/`orderDir`, unlike `buildCronContext().records.query`.

## 7. Branch and commit

Branch `agent/news`. The code is verified at `356322b`. This report is committed on top of it; the final hash is in the closing message.
