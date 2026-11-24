# DeepSpace usage

## Platform features

| Feature | Used for |
|---|---|
| Sign-in (Google/GitHub) | Every order is tied to a verified identity. Identity never comes from the browser. |
| Record store with permissions | Private orders and fills; public trades, portfolios, news, and rounds; live updates |
| Server actions | Place order, cancel order, and the owner-only "breaking news" trigger |
| Custom Durable Object (`BaseRoom`) | The matching engine, the 1-second timer, and the live market stream |
| Scheduled jobs | When news events fire. Cron controls are admin-only. |
| Presence | Who's online and which stock each trader is watching |
| `deepspace/testing` | Multi-user browser tests with three test accounts |

## Integrations: three, all in the news pipeline

News is the only place outside data enters the game, and a misleading headline is the main way news could be unfair. Each integration makes headlines more realistic or more trustworthy. All three are billed to the owner and run only on the server, so players can't spend the owner's credits.

| Integration | Used for |
|---|---|
| `anthropic/chat-completion` (Claude Haiku) | Writing the fictional headline and body for the stock, direction, and size the engine already picked. |
| `newsapi/top-headlines` | Real headlines from the stock's sector (tech, health, business), passed to Claude as style inspiration only. Cached for an hour per stock; if NewsAPI fails, the headline is written without it. |
| `cloudflare/jev` | An independent AI check after our own validation: is the item about the right company, does its tone match the price move, and does it name anything real? Any failure, including a Jev error, drops the event with no price move. |

The rest either fought the design or added cost without making trading better:

- Payments: the money is fake by design.
- Real stock quotes: they would fight the news engine.
- Image generation and text-to-speech: too slow and costly for the value.
- Chat: presence covers the social feel.
- Google/Composio: in the template config but unused; a trading game doesn't need a user's connected accounts.

## Main tradeoff

**A custom room for the engine instead of the built-in record store.** The record room keeps its write path private, server actions can interleave, and the scheduler runs at most once a minute. A matching engine needs atomic, serialized writes and a 1-second timer.

The cost is more code to own and review, paid for with an independent money review and per-batch conservation checks. The benefit is a fairness guarantee the general-purpose primitives can't give. Results are still copied into the record store so the platform handles permissions and live sync ([how-it-works.md](how-it-works.md#architecture)).
