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
| engine-core | 1 | building | – | – | – | |
| market-sim | 1 | building | – | – | – | |
| news | 1 | building | – | – | – | |
| ui-shell | 1 | building | – | – | – | |
| exchange-runtime | 2 | not started | – | – | – | |
| ui-trading | 2 | not started | – | – | – | |
| review-money | 2b | not started | – | – | – | |
| evaluator | final | not started | – | – | – | |

## Log

- D0: three test accounts created (Trader A, B, C). Passwords were generated and piped straight into the CLI, so they never appeared in a command, file, or commit. The integration branch `agent/exchange` was created in `C:/DeepSpace-project-exchange`.
- Wave 0: foundation merged into `agent/exchange`. Full suite green after the merge. The director also checked: unauthenticated `placeOrder` → 401; signed-in → `round_closed`; a forged `userId` is ignored; `/exchange/shock` is not publicly routed (404).
- Director contract changes: `invalid_side`/`invalid_type` reject codes, `NewsDraw` in `contracts.ts`, and market orders store their band-edge limit. The spike gotchas are recorded in `LESSONS.md`.
