# Progress

The director updates this file as each feature moves through the loop. Newest notes go at the bottom of each section.

## Loop per builder

1. The builder finishes and pastes its own typecheck, lint, and test results.
2. The director reruns the same checks in the builder's worktree. Any failure goes back to the builder.
3. The director spawns a fresh reviewer that gets only three things: the spec, the acceptance criteria, and the diff. It checks for bugs, edge cases, security, and out-of-scope changes.
4. If there are findings: the builder fixes them, the director reruns the checks, and a fresh reviewer runs. At most 3 rounds. If round 3 still fails, the director stops and asks the user.
5. Once the reviewer passes: merge into `agent/exchange` (one merge at a time), then run the full suite on the integration branch.
6. After all builders are merged, an evaluator drives the app as a user with the test accounts. Any bugs it finds go back through the same loop.

## Status

| Worker | Wave | State | Check runs | Review rounds | Merged | Notes |
|--------|------|-------|------------|---------------|--------|-------|
| foundation | 0 | **merged** | builder ✓, director ✓ (tsc, lint, 20 unit, 11 e2e, build) | 2 (R1 FAIL: unapproved codes, resolved by a director spec update; R2 PASS) | ✓ | App registered `app_01M80AVDTA8NPYNJWXARJYZRPG`. Spike S1–S3 pass locally; prod subrequest cap still unknown. |
| engine-core | 1 | **merged** | – | – | – | |
| market-sim | 1 | **merged** | builder ✓, director ✓ (tsc, lint, 85 unit, 11 e2e) | 3 (R1 PASS; R2 PASS + 1 minor; R3 PASS after a follow-up to fix flaky slow tests) | ✓ | Bot inventory and seeding handed to exchange-runtime (LESSONS 11–13). |
| news | 1 | **merged** | – | – | – | |
| ui-shell | 1 | **merged** | – | – | – | |
| exchange-runtime | 2 | **merged** | – | – | – | |
| ui-trading | 2 | not started | – | – | – | |
| review-money | 2b | not started | – | – | – | |
| evaluator | final | not started | – | – | – | |

## Log

- D0: three test accounts created (Trader A, B, C). Passwords were generated and piped straight into the CLI, so they never appeared in a command, file, or commit. The integration branch `agent/exchange` was created in `C:/DeepSpace-project-exchange`.
- Wave 0: foundation merged into `agent/exchange`. Full suite green after the merge. The director also checked: unauthenticated `placeOrder` → 401; signed-in → `round_closed`; a forged `userId` is ignored; `/exchange/shock` is not publicly routed (404).
- Director contract changes: `invalid_side`/`invalid_type` reject codes, `NewsDraw` in `contracts.ts`, and market orders store their band-edge limit. The spike gotchas are recorded in `LESSONS.md`.
- Wave 1: market-sim merged; full suite green.
- Security fix from news's finding: the scaffold's browser integration proxy forwarded any unlisted integration billed to the owner, so any signed-in member could spend the owner's credits through Claude. Now every owner-billed integration is refused for browsers (403), and cron trigger, pause, and resume are admin-only. Commit `86ca7aa`.
- engine-core R1 PASS and merged. A follow-up made its property test about 10x faster, because slow tests were failing under the machine load of 4 parallel builders. That follow-up is in review R2. news R1 FAIL (a race in the concurrent breakingNews rate limit; a sentence counter that missed closing quotes), fixed and in R2.
- The user chose to run wave 2 **sequentially** (session usage meter at 70%): exchange-runtime first, then ui-trading.
- engine-core follow-up merged (R2 PASS + 2 minors fixed, R3 PASS). Full suite green.
- news merged after 3 rounds (R1 FAIL, R2 PASS + 3 minors fixed, R3 PASS). The director registered `breakingNews`. Full suite: 138 unit, 15 e2e, build OK. Known minors left from R3: (a) cron's integration call doesn't unwrap the `{success, code}` envelope, so a credits error gets logged as "unrecognized shape" (it still fails closed; to be confirmed during the director's real-call check); (b) a manual admin cron trigger in the same minute as the scheduled run can publish two events; (c) the breakingNews 10s limit is per isolate (owner-only, so it can only spend the owner's own credits).
- ui-shell merged after 3 rounds (all PASS; 4 + 2 minor fixes; one leftover R3 note: `publishedAt: null` renders as 1970, which the server never writes). Scaffold placeholder pages were removed. The director applied the floor theme first paint and the landing SEO copy. Full suite: 172 unit, 16 e2e (1 skipped until `/trade` exists), build OK.
- Wave 2 (sequential): exchange-runtime building.
- 21:15: the Claude Code 5-hour usage limit hit 100% while exchange-runtime was mid-task (code and API tests committed; report and manual run not done). The user chose to wait for the reset. The director cancelled the builder's auto-continue and scheduled a resume prompt for 23:31 that includes the new rules.
- User decision: no paid LLM calls on dev/test servers unless `NEWS_LLM_IN_DEV=true` (commit `27fe7bb`, with unit tests). The director's own code changes (proxy fix, cron lockdown, LLM gate, landing polish) go through an independent reviewer too.
- Director changes reviewed: R1 PASS with minors (dead `anonymous` flag, stale comment, unused import), fixed in `8a84170`; R2 PASS with no findings. Full suite: 174 unit, 16 e2e, build OK.
- exchange-runtime report in. Director checks: tsc, lint, and 226 unit tests pass. e2e was flaky: 4 failures when a run landed in the round break. Review R1 FAIL: (1) e2e tests depend on wall-clock round phase, (2) the mirror drops rows after 5 quick retries, which could leave a round stuck `live`, (3) a weak retry test. All three were sent back to the builder.
- exchange-runtime merged after 3 rounds (R1 FAIL; R2 PASS + 1 fix; R3 PASS). The director added `bad_request` to the shock contract. Full suite on `agent/exchange`: 230 unit, 22 e2e (1 skipped until `/trade` exists), build OK.
- Next: ui-trading (sequential).
