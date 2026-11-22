# Evaluator report: run 6 (targeted re-run after the plural fix)

- Code: `agent/exchange` at `a9dd56e` (merge of the ui-shell leaderboard plural fix).
- I ran `npx deepspace dev start --port 5180` and drove Trader A, B, and C with Playwright headless Chromium, signed in through `deepspace/testing` (`findTestAccountByName`, `newSignedInContext`, `chromiumLaunchOptions`).
- I made no paid calls, and I did not print or store any credentials.
- Screenshots are in `C:/Users/allen/AppData/Local/Temp/tickfair-eval/run6/`.
- I appended `EXCHANGE_ROUND_LIVE_MS=90000` and `EXCHANGE_ROUND_BREAK_MS=30000` after the server started, so I could get a fresh round with only one human. I removed exactly those two lines while the 90 s round was still live. The next round ran the default 15:00.

## Results

| # | Check | Result | Evidence |
|---|---|---|---|
| P1 | Leaderboard header, singular and plural | PASS | Fresh 90 s round, empty board ("No traders this round yet"). After A's market buy 3 ORBT, the header read "LEADERBOARD 1 trader" (`14-leaderboard-1-trader-panel.png`). In the next 15-min round, A bought, and both A's and B's terminals showed "1 trader" (`18-B-sees-1-trader.png`). B then bought CURA, and both showed "2 traders" with no reload; the URL stayed `/trade` (`19-A-sees-2-traders.png`). |
| P2 | Other count labels on `/trade`, `/home`, `/rounds` | PASS | Chart meta and its aria-label read "1 batch", then "2 batches", then "3 batches" at round start (`13-chart-1-batch.png`). The header online tooltip read "2 traders online" with A+B and "1 trader online" with A alone (`02-`, `08-header-tooltip-*.png`). `/home` showed "1 trader" and "1 online" (`15-home-1-trader.png`). `/rounds` showed the new A-only round as "1:30 · 1 trader", and other rows read "0 traders" and "2 traders" (`17-rounds-1-trader.png`). A regex scan of body text plus aria-label and title text on `/trade`, `/home`, and `/rounds` found no "1 traders/batches/…" or "N trader/batch" (N≠1). |
| 3 | Terminal live | PASS | ORBT, CURA, and VOLT tabs present. Over 3 s, batch #268 went to #271 and the round countdown went 9:16 → 9:13. The tape top print changed, and there were 60 tape rows. The chart showed "82 batches", last 119.91. The ladder showed aggregated price and shares only, with no names. A transient bot bid at the band edge was labelled "crosses next batch" and cleared within one batch. The ticket, open orders, fills, positions, news ("No news this round", honest empty), leaderboard, and online list were all present (`01-terminal-A.png`, `21-ladder.png`). |
| 5 | Two players, same batch | PASS | A limit sold 2 VOLT at 78.71 and B limit bought 2 VOLT at 80.31; the clicks were 178 ms apart. Both got "Order in for batch #315.", and both filled in #315 at 79.48. Both tapes showed the print "VOLT 79.48 … 2". No reload. A's VOLT went 2 → 0 and cash 99,121.59 → 99,280.55 (+158.96). B's VOLT went 8 → 10 and cash 98,761.66 → 98,602.70 (−158.96). Both leaderboards updated live (`04-cross-A.png`, `04-cross-B.png`). |
| 7 | Cancel frees the reservation | PASS | **Cash:** B's limit buy 5 VOLT at 73.82 showed reserve "$369.10". Free cash went $98,602.70 → $98,233.60. After Cancel, the row was gone and free cash was back to $98,602.70 (`05-cancel-B-*.png`). **Shares:** A's limit sell 6 ORBT at 128.93 reserved them, and selling 1 more then showed "More than your free shares. The exchange will refuse it." After Cancel, a sell of 6 showed no warning (`06-shares-*.png`). |
| 10 | Leaderboard math | PASS | **Pre-cross:** A cash 99,121.59 + 6×119.91 + 2×79.84 = 100,000.73, matching the Positions panel. **After the cross:** A 99,280.55 + 6×119.97 = 100,000.37, and the board showed $100,000 / +$0.37. B 98,602.70 + 5×119.97 + 10×79.81 = 100,000.65, and the board showed $100,001 / +$0.65. **Fresh round:** A 99,759.32 + 2×120.12 = 99,999.56, shown as $100,000 / −$0.44. B 99,819.60 + 4×44.97 = 99,999.48, shown as $99,999 / −$0.52. Bots never appeared; there were only human rows. Each new round started from $100,000 (`20-leaderboard-math-*.png`). |
| 12 | Presence, including a late joiner | PASS | A saw B switch CURA → VOLT within about 0.3 s, and B saw A switch to VOLT within about 0.3 s (`03-presence-A-sees-B-VOLT.png`). After A and B had been on the floor for about 4 min, C opened `/trade`. C saw "3 online" with A on ORBT and B on VOLT within 286 ms of the terminal loading, before any 15 s heartbeat (`07-late-joiner-C.png`). A and B both saw C on ORBT. After B and C closed, A showed "1 online" within 2.3 s. |

Round rollover was also seen along the way. The results overlay listed standings ("1 Trader A $99,997, 2 Trader B $99,994", then a single-trader overlay "1 Trader A $100,000"). `/rounds` listed those rounds with their winners (`12-`, `16-`, `17-*.png`).

## Bugs

None found in this run.

## Stubbed, faked, or half working

Nothing seen. The news panel showed an honest empty state, which is expected in dev with no LLM.

## Cleanup

- I removed the two `.dev.vars` override lines and checked that no `EXCHANGE_ROUND` lines remain.
- I stopped the dev server. A leftover `node` child was still holding the port, so I killed that tree, and port 5180 no longer has a listener.
- I wrote no throwaway scripts to disk; I drove the checks from an in-memory session. Only the screenshots remain.
- I committed nothing.

VERDICT: PASS
