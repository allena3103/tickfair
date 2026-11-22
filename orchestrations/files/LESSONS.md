# Lessons

Every builder reads this before starting. The director adds entries as they come up.

## From foundation (wave 0)

1. **Getting a JWT in a test:** `POST /api/auth/token` with `credentials: 'include'` returns `{ token }`. A GET returns 404. Never log the token.
2. **Writing records from server code with a known id:** use the RecordRoom stub fetch to `https://internal/api/tools/execute` with `{ tool: 'records.create', params: { collection, recordId, data } }` and headers `X-App-Action: true` plus `X-User-Id`. If the id exists, the write merges into it. `buildCronContext().records.create` has no id parameter. (`SPIKE.md` S3.)
3. **`userBound` columns are stamped with `X-User-Id`.** Write `orders` and `fills` with `X-User-Id` set to the trader's id, not the owner's, or `'own'` reads break.
4. **An `immutable` field rejects the whole write** if the new value differs. Leave `userId` out of `orders` and `fills` updates.
5. `deleteWhere` caps at 500 rows per call. Drain it in a loop.
6. **Counting live sockets:** filter `getWebSockets()` by `readyState === 1`. A socket that is closing still appears for a moment.
7. **Mirror budget:** at most 40 parallel record writes per tick, coalesced by recordId. Carry any extra to the next tick. The production subrequest cap is still unverified.
8. **AI integration:** `anthropic/chat-completion` defaults to `claude-opus-5-5` with 4096 max tokens. Always set `model: 'claude-haiku-4-5'` and a small `max_tokens`. The response shape is undocumented (`outputSchema: null`), so parse it defensively.
9. **Ports:** the Playwright config reuses a server that's already listening. Always pass `--port` to `test run`, or you may test another checkout's code.

## From market-sim (wave 1)

10. **`deltaBps` is signed** (direction × size). `/exchange/shock` receives it as is: +600 means up 6%, −600 means down 6%.
11. **Bots need inventory.** Under long-only rules, the market maker and noise trader can't sell shares they don't hold. exchange-runtime must seed the bot accounts (`bot:mm`, `bot:noise`) with cash and shares at each round start. Bot accounts are included in the conservation invariant and excluded from the leaderboard.
12. **The runtime owns `BotState.inventory`.** market-sim passes it through unchanged. exchange-runtime must update it from the market maker's fills each batch.
13. **The price band is inclusive.** An order exactly at last × (1 ± 10%) is inside the band. The noise trader places orders on the edge.

## From engine-core (wave 1)

14. **Account meaning:** `cashCents` is free cash, and `reservedCents` is cash held for open buys. `holdings.qty` is total shares, and `reservedQty` is the part held for open sells.
15. **Band edges are exact integers that round inward** (last 1005 → top 1105). Before reserving a bot intent, clamp its limit with engine-core's band function (`priceBand`/`marketLimit`). If a bot intent is rejected, log it; it must never halt the batch.
16. **`rate_limited` (the per-batch order cap) is not in engine-core.** exchange-runtime enforces it.
