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
claude mcp add stockintel --transport http https://stockintel-eight.vercel.app/mcp
```

Then call `stockintel_read` and `stockintel_status`.

**When both servers are connected, fetch the market leg first.** Call your Binance market-data tools for the tickers, then pass those results verbatim into `stockintel_read` as `binance_market_data`. StockIntel reads price and 24h change out of them and marks that leg caller-supplied. Omit it and StockIntel resolves the same public numbers itself through Agent OS or the mirror.

**HTTP.** Base URL: `https://stockintel-eight.vercel.app`.

## Commands

| Caller intent | Request |
|---|---|
| Market read on tickers | `POST /api/market/read` `{"tickers":["NVDA","MU"]}` |
| Read with your own exchange leg | `POST /api/market/read` `{"tickers":["BTC"],"binance_market_data":{...}}` |
| Is StockIntel live on Agent OS | `GET /api/binance/status` |

```bash
curl -s -X POST "$STOCKINTEL_BASE/api/market/read" -H 'content-type: application/json' -d '{"tickers":["NVDA"]}'
```

## How to present the result

- Each quote carries `price`, `change24hPct`, `provenance`, and `lines`. Provenance says `caller-supplied`, `agent-os`, or `mirror`. Repeat it honestly.
- `lines` after the first carry the positioning gauge: range position, 14-session run, daily wobble. A fresh thesis with a small move suggests underpriced. A large move already reflecting the event suggests priced.
- A null price means no Binance listing. Say so, never guess.
- StockIntel proposes assessments, never trade instructions.
