# How it was built

I directed one main agent (Claude Code), and it directed the rest. I set the goals, made the product and design decisions, and approved each stage. The main agent planned, wrote the briefs, started each builder as its own Claude Code session in its own git worktree (a tab in my terminal workspace), spawned reviewers and the evaluator, checked their output, and merged.

Every prompt, word for word: [PROMPTS.md](../PROMPTS.md).

## Steps

1. **Plan first.** The main agent wrote [PLAN.md](../PLAN.md) (scope, fairness algorithm, data model, risks). I answered its open questions and approved it. A shared brief, [BRIEF.md](../orchestrations/files/BRIEF.md), froze the interfaces so agents could work in parallel.
2. **Waves** ([orchestrations/files/](../orchestrations/files/)):
   - `foundation` alone: app skeleton, data definitions, risk checks ([SPIKE.md](../orchestrations/files/SPIKE.md)).
   - Then `engine-core`, `market-sim`, `news`, and `ui-shell` in parallel, each owning separate files.
   - Then `exchange-runtime` and `ui-trading` one at a time, to save usage when the meter got high.
3. **Loop for every builder**, which I specified and the main agent enforced:
   - the builder runs its own typecheck, lint, and tests;
   - the main agent reruns them instead of trusting the report;
   - a **fresh reviewer** sees only the spec, acceptance criteria, and diff;
   - findings go back to the builder, at most 3 rounds;
   - one branch merges at a time, with the full suite after each merge.
4. **Independent money review** of the whole engine: PASS; its one minor issue was fixed.
5. **Skeptical evaluator** ([08-evaluator.md](../orchestrations/files/08-evaluator.md)): a separate agent drove the real app in three browsers as Traders A, B, and C against 18 acceptance criteria, told to fail anything stubbed or half-working. Run 1 failed on a broken anchor link; run 4 failed because late joiners saw others without their stock; run 5 passed all 18; run 6, a targeted recheck, found nothing.

Worker reports: [orchestrations/files/reports/](../orchestrations/files/reports/). Build log: [PROGRESS.md](../orchestrations/files/PROGRESS.md). Lessons: [LESSONS.md](../orchestrations/files/LESSONS.md).

## What I caught or decided myself

- A builder found that the template's browser integration route let any signed-in user spend my AI credits. I had it closed for every owner-billed service, not just Claude.
- I kept paid AI calls off on dev and test servers, and made one verified real call instead.
- I judged reviewer findings instead of applying them blindly. One flagged reject codes I had approved, so I updated the spec instead of reverting. I rejected another after the source showed the rounding was already correct.
- Test credentials were generated and piped straight into the CLI. They never appear in any file, log, or commit.
