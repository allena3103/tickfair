# Development

Needs Node 24, npm 11, and a DeepSpace account.

```bash
npm ci
npx deepspace dev start          # http://localhost:5173
npx deepspace test run all       # unit + browser tests
npx deepspace deploy             # ship to tickfair.app.space
```

Other scripts are in `package.json`.

Local servers make no paid AI calls, so news is off by default (the log shows `[news] skipped llm_disabled_in_dev`). To turn it on, start the server first (`dev start` rewrites `.dev.vars`), then, from another terminal:

```bash
echo NEWS_LLM_IN_DEV=true >> .dev.vars   # the server restarts and picks it up
```

News only fires during a live round, about every other minute. Each event bills your account for one Claude and one Jev call, plus one NewsAPI call per stock per hour. Remove the line when done: `sed -i '/^NEWS_LLM_IN_DEV=/d' .dev.vars`.

Agent instructions and the DeepSpace docs index: [AGENTS.md](../AGENTS.md).
