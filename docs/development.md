# Development

Needs Node 24, npm 11, and a DeepSpace account.

```bash
npm ci
npx deepspace dev start          # http://localhost:5173
npx deepspace test run all       # unit + browser tests
npx deepspace deploy             # ship to tickfair.app.space
```

Other scripts are in `package.json`.

Local servers don't make paid AI calls, so news headlines are off unless you set `NEWS_LLM_IN_DEV=true`.

Agent instructions and the DeepSpace docs index: [AGENTS.md](../AGENTS.md).
