# Status

## Verified

- Final full evaluator run (run 5): 18 of 18 acceptance criteria, plus a clean targeted recheck (run 6).
- Unit and browser suites pass (`npx deepspace test run all`).
- **Production** (<https://tickfair.app.space>), rechecked on 2026-11-24 after the bots, sim players, and "How it works" modal shipped: the two-trader and smoke browser suites run against the live URL pass (one screenshot-only test skipped). A real crossing trade fills for both traders, the tape and leaderboard agree, open orders stay private, presence works for late joiners, and each browser shows its own account.
- **News in production**, after the NewsAPI and Jev deploy: a signed-in trader saw a new checked headline go live within minutes. Before that, one real run through the code (NewsAPI, then Claude, then Jev) produced a valid headline, and Jev rejected a test headline that named a real brand.

Not load-tested: production subrequest limits for the record-copy step beyond normal play (capped at 40 writes per batch).

## Known limitations

- If a trader closes one of two open tabs, they drop off the online list. This comes from the SDK's per-user presence.
- A trader can confirm who won a tie from the published seed, but can't recompute the seed itself, because it hashes private order ids.
- If every player finishes level, the winner is picked by account id.
- News runs on the owner's DeepSpace credits (about $0.09 per hour of live play). If they run out, news stops; trading keeps working.
- Local dev servers make no paid calls, so news is off locally unless turned on ([development.md](development.md)).

## Next

- A per-trade "fairness audit" panel.
- A strategy API, so players can write their own trading bots.
- Shorting with margin.
- Candle-chart history and round replays.
