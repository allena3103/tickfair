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
