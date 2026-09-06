# StockIntel on Binance Agent OS (Track A)

StockIntel is an AI agent that investigates the world behind a ticker and
checks its thesis against live market context through Binance Agent OS.
Event first, exposure second, thesis third, market check last. The market
never writes the narrative. It tests it.

## The integration in one paragraph

After the thesis exists, StockIntel resolves each assessed company to a
Binance listing, snapshots price and 24h move, and runs a positioning gauge
over daily candles. Market data needs no key. Workspaces paste their
sub-account balances once and research reads against their holdings from
then on. Outside agents consume the same read over HTTP or through
StockIntel's own MCP server. All market reads are read-only. The app never
requests trade, transfer, or withdrawal scopes.

## Why this shape

Binance only recognises its approved agent clients, so StockIntel never
acts as an OAuth client itself. The connection lives in the calling
agent's own session. StockIntel joins as a second MCP server next to
`binance-mcp-server`, and calling agents pass their exchange leg in
verbatim. Provenance travels with every quote: caller-supplied, agent-os,
or mirror.

## Judge setup (two minutes)

Option 1, MCP client:

1. Add both servers:
   `claude mcp add binance-mcp-server --transport http https://agent.binance.com/mcp/agentic`
   `claude mcp add stockintel --transport http https://stockintelislive.vercel.app/mcp`
2. Authenticate the Binance server in the browser and fund an Agentic sub-account.
3. Call `stockintel_read` with tickers, passing your Binance tool output as `binance_market_data` for the exchange leg.

Option 2, plain HTTP, no key:

1. `POST /api/market/read` with `{"tickers":["NVDA","MU"]}`.
2. Add `binance_market_data` with your own MCP tool output to mark that leg caller-supplied.
3. `GET /api/binance/status` reports the deployment's own Agent OS state.

Option 3, headless probe:

1. `bun scripts/agent-os-probe.ts BTCUSDT`
2. Without a token it reports the fallback state. With `BINANCE_MCP_TOKEN` set it lists live tools and one ticker.

## Architecture

```
thesis (off-market) -> buildMarketSnapshot -> Agent OS MCP when live
                                              public mirror when not
                    -> positioningGauge   -> range position, 14-session run, daily wobble
                    -> synthesis          -> priced, underpriced, or unclear per exposure
outside agents -----> /mcp stockintel_read | POST /api/market/read (same core)
```

Key files:

- `src/lib/binance/agent-os.ts` is the MCP client on the official SDK. Tool names resolve from the server's own `tools/list`, never from a hardcoded snapshot.
- `src/lib/binance/inject.ts` reads a calling agent's verbatim MCP output without assuming field names. Provenance stays caller-supplied.
- `src/lib/binance/read.ts` is the single market-read core behind HTTP and MCP so the surfaces never drift.
- `src/lib/server/stockintel-mcp.ts` serves `stockintel_read` and `stockintel_status` over Streamable HTTP, stateless per request.
- `src/lib/server/connector-api.ts` serves `POST /api/market/read` and `GET /api/binance/status`.
- `skills/stockintel/SKILL.md` documents both call methods for agents.
- `scripts/agent-os-probe.ts` is the headless proof. `.mcp.json` wires the Binance server into Claude Code project scope.

## Replicate this agent (survey answer)

1. Clone the repo and install: `git clone <url> && cd stockintel && bun install`.
2. Run it: `bun run dev` serves the app on 8080. `bun run build` is the production gate.
3. Connect the Binance side in your own approved client:
   `claude mcp add binance-mcp-server --transport http https://agent.binance.com/mcp/agentic`,
   then authenticate in the browser and fund an Agentic sub-account with read-only scopes.
4. Add StockIntel next to it:
   `claude mcp add stockintel --transport http <your-deploy>/mcp`.
5. Verify: call `stockintel_status`, then `stockintel_read` with `{"tickers":["NVDA"]}`. For HTTP only, `POST <your-deploy>/api/market/read` needs no key.
6. Optional live server session: authenticate inside your own supported client, set the resulting token as `BINANCE_MCP_TOKEN` in `.env`, and the deployment lists live tools via `bun scripts/agent-os-probe.ts`.
7. The app needs `VITE_PRIVY_APP_ID` for sign-in and a database URL. Everything else degrades honestly when unset.

## Demo script (60 seconds)

1. Ask: Watch NVDA, what is happening in the world that could materially change its value?
2. Point at the assessment cards: event, exposure path, evidence, invalidation.
3. Point at the market check card: thesis formed first, price consulted second, source badge honest.
4. Paste sub-account balances into the holdings prompt, import ticked, rerun. Theses now speak to held positions.
5. In a client session, call `stockintel_read` with your Binance leg passed in for the agent-to-agent proof.

## Submission checklist

- [ ] `.mcp.json` points at `https://agent.binance.com/mcp/agentic`
- [ ] `POST /api/market/read` returns quotes with provenance
- [ ] `/mcp` answers `stockintel_status` from an MCP client
- [ ] `bun scripts/agent-os-probe.ts` prints live tools with a token set
- [ ] Readout badge shows the true source on every run
- [ ] Video follows the demo script above
