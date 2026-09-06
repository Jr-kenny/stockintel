---
name: stockintel
description: |
  Event-driven equity intelligence with live market context: name a ticker and StockIntel
  investigates the world behind it, then checks the thesis against live Binance prices plus
  the positioning gauge. Use when the user asks "what is happening that could move NVDA",
  "who is exposed to this buildout", "is this thesis priced in", or wants a market read on
  up to 20 tickers. Read-only, no key needed. Never a trade instruction.
metadata:
  author: prime-isles
  version: "1.0"
license: MIT
---

# StockIntel

Two ways in, as an MCP server, or as plain HTTP.

**MCP (preferred).** StockIntel runs alongside the Binance MCP Server in the same session:

```bash
claude mcp add binance-mcp-server --transport http https://agent.binance.com/mcp/agentic
claude mcp add stockintel --transport http https://stockintelislive.vercel.app/mcp
```

Codex: `codex mcp add stockintel --url https://stockintelislive.vercel.app/mcp` (no auth flag, our server needs no key). ChatGPT web: Settings, Security, Developer Mode, Plugins, +, name it StockIntel, plugin URL `https://stockintelislive.vercel.app/mcp`, Create. Check it: ask your chat to read NVDA through the StockIntel tools and confirm the tool ran.

Then call `stockintel_investigate` first for a live thesis: the full ten-specialist grid investigates and the orchestrator connects event to exposure to verdict. Poll `stockintel_inquiry` until complete. For previous thinking, `stockintel_assess` serves the latest thesis, `stockintel_clusters` the grouped evidence, `stockintel_thesis_changes` what moved, `stockintel_conflicting` the counter-case, `stockintel_evidence` one thread drilled down. Stored reads admit their age past a day. `stockintel_read` covers market context, `stockintel_status` the deployment state.

**When both servers are connected, fetch the market leg first.** Call your Binance market-data tools for the tickers, then pass those results verbatim into `stockintel_read` as `binance_market_data`. StockIntel reads price and 24h change out of them and marks that leg caller-supplied. Omit it and StockIntel resolves the same public numbers itself through Agent OS or the mirror.

**HTTP.** Base URL: `https://stockintelislive.vercel.app`.

## Commands

| Caller intent | Request |
|---|---|
| Live investigation and thesis | `POST /api/market/investigate` `{"question":"Watch NVDA: what could move it?"}` then `POST /api/market/inquiry` `{"inquiry_id":"INQ-..."}` |
| Market read on tickers | `POST /api/market/read` `{"tickers":["NVDA","MU"]}` |
| Read with your own exchange leg | `POST /api/market/read` `{"tickers":["BTC"],"binance_market_data":{...}}` |
| Previous thesis for a ticker | `POST /api/market/assess` `{"ticker":"NVDA"}` |
| Evidence clusters without verdicts | `POST /api/market/clusters` `{"ticker":"NVDA"}` |
| What changed between assessments | `POST /api/market/changes` `{"ticker":"NVDA"}` |
| What argues against the thesis | `POST /api/market/conflicting` `{"ticker":"NVDA"}` |
| Drill into one thread | `POST /api/market/evidence` `{"ticker":"NVDA","company":"NVIDIA"}` |
| Is StockIntel live on Agent OS | `GET /api/binance/status` |

```bash
curl -s -X POST "$STOCKINTEL_BASE/api/market/read" -H 'content-type: application/json' -d '{"tickers":["NVDA"]}'
```

## How to present the result

- Each quote carries `price`, `change24hPct`, `provenance`, and `lines`. Provenance says `caller-supplied`, `agent-os`, or `mirror`. Repeat it honestly.
- `lines` after the first carry the positioning gauge: range position, 14-session run, daily wobble. A fresh thesis with a small move suggests underpriced. A large move already reflecting the event suggests priced.
- A null price means no Binance listing. Say so, never guess.
- StockIntel proposes assessments, never trade instructions.
