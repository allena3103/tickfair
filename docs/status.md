# Status

## Verified

- Final full evaluator run (run 5): 18 of 18 acceptance criteria, plus a clean targeted recheck (run 6).
- Unit and browser suites pass (`npx deepspace test run all`).
- One real AI headline generated and validated.
- **Production** (<https://tickfair.app.space>): the two-trader browser tests run against the live URL. A real crossing trade fills for both traders, the tape and leaderboard agree, open orders stay private, presence works, and each browser shows its own account.

Not load-tested: production subrequest limits for the record-copy step beyond normal play (capped at 40 writes per batch).

## Known limitations

- If a trader closes one of two open tabs, they drop off the online list. This comes from the SDK's per-user presence.
- A trader can confirm who won a tie from the published seed, but can't recompute the seed itself, because it hashes private order ids.
- If every player finishes level, the winner is picked by account id.

## Next

- A per-trade "fairness audit" panel.
- A strategy API, so players can write their own trading bots.
- Shorting with margin.
- Candle-chart history and round replays.
