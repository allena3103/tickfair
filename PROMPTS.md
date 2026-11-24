# Prompts

A curated set of the prompts I gave the coding agent, word for word, in order. Under each is a short note on what the agent did and what I decided or checked.

## Prompt 1: Plan the project (no building yet)

> I would like to create a Simulated HFT project. There are specific guidelines I need to follow, so I created a md file @project-guidlines.md for you to refer to throughout this build.
>
> for this project, I want you to build a multiplayer simulated stock exchange on DeepSpace. players will trade fake money against a live order book, with trades, positions and a leaderboard updating in real time for everyone. Use fake  news events to move the price, and make it fair when two people order at the same instant.
>
> Lets refine/ further plan out this project, make sure you refer to @project-guidlines.md to ensure we are properly integrating their tools and following instructions. I want you to create a new markdown containing all of my prompts so that judges can easily view my workflow and thought processes. we're only planning for now, so await specific instruction before actually building.

**Agent's research**

* Read the DeepSpace docs (index, architecture, data model, permissions, realtime sync, server actions, scheduled jobs, external APIs, presence, testing, and the build methodology).
* Read the DeepSpace agent skill.
* Pulled the integration catalog.
* Inspected the SDK's type definitions (`deepspace@0.44.2`).

**Agent's key finding**

RecordRoom's write and broadcast internals are private, and the built-in cron runs at most once a minute. A safe, serialized matching engine with 1-second batches therefore needs a custom Durable Object built on the SDK's `BaseRoom`. RecordRoom stays as the real-time, permission-filtered view of results.

**My decisions** (the agent asked; I chose):

|Question|My answer|
|-|-|
|Fairness model|Frequent batch auction|
|Number of stocks|3 fictional tickers in different sectors|
|Time model|Timed rounds with reset|
|Risk rules|Long-only, no margin|
|Chat|No chat|

**Output**

* `PLAN.md`: the architecture, data model, fairness algorithm, news pipeline, integrations used and left out with reasons, security rules, test plan, five-day schedule, and the risk checks to run first.
* This file.
* No code was written, per my instruction.

## Prompt 2: Break the plan into tasks for sub-agents

> this plan looks good. I want you to break it into smaller tasks so we can allocate it to sub agents.

**What the agent did**

* Split `PLAN.md` into 8 worker tasks plus director-only steps, in `orchestrations/files/`:

  * `README.md`: waves, file ownership, ports, merge order.
  * `BRIEF.md`: shared rules and frozen interface contracts.
  * One task file per worker:

    * `foundation`: scaffold, schemas, contracts, and the risk-check spike
    * `engine-core`: matching and money math, as a pure module with property tests
    * `market-sim`: bots and the hidden value walk
    * `news`: cron, the LLM call, and validation
    * `ui-shell`: design, landing page, and feed panels
    * `exchange-runtime`: the matching Durable Object, rounds, and the mirror into DeepSpace records
    * `ui-trading`: the trading terminal
    * `review-money`: an independent, read-only review of the money path
* Following my director workflow, each worker gets its own git worktree, branch, and port. Workers start in herdr tabs, not as hidden sub-agents.
* Contracts are frozen up front so parallel workers can't make conflicting decisions. No two workers in the same wave own the same file.

**Status:** planned only. No repo, scaffold, or workers have been created yet.

## Prompt 3: Start the build as director

> yes that sounds good, lets go with 3 accounts, give them generic names. the task split also looks good. you may proceed with the subagents and I want you to act as the director. Have each builder agent work in their own worktree and run them in parallel only if they touch different files.
>
> After each builder is done, have it run its own typecheck, lint, tests. It will be your job to double check and run these same tests after the builder is done. if they fail, send the errors back to the builder. after these test pass spawn a reviewer agent and only provide it with the spec, the feature's acceptance criteria, and the diff, it should have no other context. have it check for Bugs, edge cases, security, and anything out of scope. if the reviewer finds issues, send them to the builder. after the fix, rerun the checks yourself, then spawn a fresh reviewer. max 3 rounds.
>
> When the reviewer agent gives the ok, you may merge that worktree, merge one at a time and run the full test suite after each merge. When all subagents are done with their tasks spawn an evaluator and have it run like a user and test all the acceptance criteria. Have it use our test accounts. It should be skeptical and fail anything stubbed or half working. Bugs go back through the loop and it runs again. Don't trust a subagent's "done" and dont put test logins in files or commits. Update progress as features finish
>
> stop and ask if something is unclear or a loop fails 3 times

**What the agent did** (full status and evidence are in `orchestrations/files/PROGRESS.md`)

* Created test accounts "Trader A", "Trader B", and "Trader C" (`trader-{a,b,c}@deepspace.test`). Passwords were random and piped through stdin, so they never appeared in a command line, file, or commit.
* Created the integration branch `agent/exchange`. Added the builder self-check rule and the credential rule to `BRIEF.md`, and added the loop and status table in `PROGRESS.md`.
* Each builder runs as its own Claude Code session in a herdr tab with its own worktree. Reviewers and the evaluator are fresh agents that get only the inputs listed above.

## Prompt 4: Stop the page scrolling past the last panel

> on the website, i can scroll past the last containers into an empty black area. I want to make sure that the page stops scrolling after the last container. Lets investigate what this issue could be, check for extra padding, fixed heights, etc.

**What the agent did:** measured the real page in a headless browser instead of guessing. On `/home` the whole document scrolled to 2003px, although the content ended at 818px inside an 851px `<main>`. Padding, fixed heights, and the `h-screen` shell were all fine. The cause was the hidden screen-reader labels in the Tape and Leaderboard rows: Tailwind's `sr-only` is `position: absolute`, and with no positioned ancestor they were placed against the page, escaped the panels' `overflow-y-auto` clipping, and stretched the document down to the rows hidden inside the panel scroller. The fix adds `relative` to the `FeedPanel` scroll body (the source) and to the app `<main>` (a catch-all). Verified at 1440×900 and 390×844: the document height dropped from 2003 to the viewport height, and on mobile `<main>`'s scroll height equals the content height exactly.

## Prompt 5: Plan a server-side market-maker bot

> i want the market to look alive, so I want you to add simulated trading activity inside the app.
>
> first, check how orders are placed and tell me if bot orders can be placed server-side without a real user account. if they can't, tell me what the options are before building anything.
>
> then build a simple market maker: a server-side job that places small random buy and sell orders around the current price every second or two, using the same order logic as real players so the book and price chart move.
>
> lets plan this out, dont build anything yet.

**What the agent did:** Found that a server-side market maker (`bot:mm`) and noise trader (`bot:noise`) already exist and trade through the same `submit()` path as players each 1 s batch, using bot accounts in the exchange room's own SQL (no real user accounts). Ran a throwaway 300-batch simulation with no players: about 30% of batches printed per ticker and prices moved about 1-1.4%. Gave the user options to make the market look busier instead of building a duplicate bot; nothing built.

## Prompt 6: Build the depth bot with review rounds

> go. build the depth bot plan on a branch.
>
> once everything passes, spawn a reviewer subagent and give it only the plan, its tests as the acceptance criteria, and the diff. no other context. lets have it check for bugs, edge cases, security, and anything outside the plan, especially the stale-price risk after news and the order limits in submit(). if it finds issues, fix them, rerun the checks, and spawn a fresh reviewer. max 3 rounds.
>
> then rerun the 5-minute no-player simulation, run the app locally and check that the depth ladder fills and the chart still moves. show me the results and the diff summary. don't merge until i ok it.

**What the agent did:** Built per-ticker depth bots on branch `agent/depth-bot` (4 commits, not merged). Three fresh reviewer rounds: R1 found depth could rest alone if a maker quote was rejected (fixed: anchor on accepted maker quotes); R2 found a deploy mid-round would halt the live round because the new bot accounts were missing (fixed: seed missing bots on restart) and a weak band-edge test (tightened); R3 approved with one test-robustness note (fixed). Lint, typecheck, 294 tests, and build pass. 5-minute no-player sim: same trades and prices as main, depth levels went from about 1.1 to 4.1 per side. Local dev check as Trader A: ladder shows 4 bot levels a side and the chart and tape keep moving.

## Prompt 7: Approve and merge the depth bot

> looks good, you may merge

**What the agent did:** Fast-forward merged `agent/depth-bot` into `main` locally and reran the checks on `main`. Not pushed.

## Prompt 8: How to test with multiple fake players

> how can i test with multiple fake players

**What the agent did:** Explained the options using the three existing `@deepspace.test` accounts: the multi-user Playwright fixture (`tests/collab.spec.ts`), signing in by hand in separate browser profiles, and a script that drives several signed-in players. Nothing built.

## Prompt 9: Fake players that are active whenever someone trades

> yes lets go with 3, but how can we make them look active every time someone starts a trade

**What the agent did:** Pointed out that a Playwright script only runs while the user's machine runs it, so it can't make the live site look busy for visitors. Proposed server-side simulated players in the exchange room instead, and asked how they should be labeled and where they should appear. Nothing built yet.

## Prompt 10: Build the sim players

> Plan looks perfect, you may begin. let's reuse the mutli-agent test workflow.

**What the agent did:** Built four labeled sim players (Momentum Max, Reversion Rita, Dip Buyer Dan, Casual Cal) on `agent/sim-players`. They trade through the same order path on public prices only, start each round like a human, show on the leaderboard with a BOT tag, and never count in standings. Raised their activity after a probe showed too few trades. A fresh reviewer approved in round 1 (one informational note on stale-quote sharing). Lint, typecheck, 302 tests, and build pass. 5-minute sim: about 125 of 300 batches traded per ticker (up from about 90), volume nearly doubled. Local check: the leaderboard shows all four with BOT tags and equity changing. Not merged; waiting for the user.

## Prompt 11: Plan a How it works modal

> the "Orders in the same 1-second batch are treated as simultaneous. How it works" section should be a modal not bring me back to a different webpage. lets plan this out, dont change anything yet

**What the agent did:** Found the "How it works" link in `OrderTicket.tsx` navigates to `/#how-it-works` on the landing page. Planned replacing it with a button that opens a modal reusing the landing page's batch-auction explainer (shared component), plus updating the smoke test. Nothing changed yet.

## Prompt 12: Build the How it works modal

> build

**What the agent did:** On `agent/how-modal`, replaced the ticket's "How it works" link with a button that opens a modal. Moved the explainer into a shared `BatchAuctionExplainer` used by both the landing page and the modal, and updated the smoke test. Smoke tests and lint, typecheck, 302 unit tests, and build pass. Desktop and mobile screenshots checked. A fresh reviewer approved with two small cleanups (applied). Not merged.

