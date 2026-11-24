# tickfair

**A multiplayer stock exchange you can't win just by being faster.** Trade three made-up stocks with fake money against a live order book. Orders in the same second clear together at one price, so speed gives no edge. AI-written fake news moves prices.

**Live:** <https://tickfair.app.space> · Built on [DeepSpace](https://docs.deep.space) by directing a team of coding agents.

**How I directed the agents:** [PROMPTS.md](PROMPTS.md), the key prompts word for word and what happened after each.

## Try it

1. Click **Sign in to trade** and sign in with Google or GitHub.
2. On `/trade`, pick a stock and place an order. You start each round with $100,000.
3. Open a second browser as another user to watch both of you trade live.

## Docs

- **How it works** - Orders are batched every second and cleared at one price, so speed gives no edge. One server-side room settles all trades, and bots keep the market moving. [More](docs/how-it-works.md)
- **DeepSpace usage** - Sign-in, permissioned records, server actions, scheduled jobs, presence, and a custom room; three integrations, all making news realistic and trustworthy (Claude, NewsAPI, Jev). [More](docs/deepspace.md)
- **Development** - `npm ci`, then `npx deepspace dev start`. [More](docs/development.md)
- **How it was built** - I directed one main agent, which ran builders in parallel worktrees, fresh reviewers, and a skeptical evaluator. [More](docs/process.md)
- **Status** - Live and checked in production; a few known limitations. [More](docs/status.md)
- **Design** - The visual direction and style tile. [More](docs/design/)
- **History** - The original plan and agent briefs. [PLAN.md](PLAN.md), [orchestrations/files/](orchestrations/files/)
