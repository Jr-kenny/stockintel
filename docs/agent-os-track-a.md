# StockIntel on Binance Agent OS (Track A)

StockIntel is an AI agent that investigates the world behind a ticker and
checks its thesis against live market context through the Binance Agent OS
MCP server. Event first, exposure second, thesis third, market check last.
The market never writes the narrative. It tests it.

## The integration in one paragraph

After the thesis exists, StockIntel resolves each assessed company to a
Binance listing, snapshots price and 24h move, and runs a positioning gauge
over daily candles. Authenticated calls (account context inside the
permissioned Agentic sub-account) unlock when the workspace owner connects.
All market reads are read-only. The app never requests trade, transfer, or
withdrawal scopes, and every readout badge says honestly whether context
came through Agent OS or the public mirror.

## Judge setup (two minutes)

Option 1, MCP client (full Agent OS session):

1. Add the server: `claude mcp add binance-mcp-server --transport http https://www.binance.com/mcp/agentic`
2. In the client, open `/mcp`, select it, and Authenticate in the browser.
3. Pick the agent and grant read-only market data plus read-only account on the Agentic sub-account.
4. This repo ships the same address in `.mcp.json`, so Claude Code project scope picks it up with no flags.

Option 2, in-app connect (per workspace):

1. Sign in on `/app`. A prompt explains the link: read-only market data plus read-only account, no trading, disconnect anytime.
2. Press Authorise to approve on Binance, or Cancel to keep running unconnected.
3. Back in the app, detected holdings show with every box ticked. Untick to reject, import the rest. Imports land on the watchlist tagged Agent OS.
4. The prompt never nags twice, and Connect Binance OS stays beside Rename and Sign out in the workspace menu.
5. Every later run folds the watchlist into the market snapshot and speaks to held positions directly.

Option 3, headless probe (no browser):

1. `bun scripts/agent-os-probe.ts BTCUSDT`
2. Without a token it reports the fallback state. With `BINANCE_MCP_TOKEN` set it lists live tools and one ticker.

## Architecture

```
thesis (off-market) -> buildMarketSnapshot -> Agent OS MCP when live
                                              public mirror when not
                    -> positioningGauge   -> range position, 14-session run, daily wobble
                    -> synthesis          -> priced, underpriced, or unclear per exposure
```

Key files:

- `src/lib/binance/agent-os.ts` does the MCP client over Streamable HTTP. Tool names resolve from the server's own `tools/list`, never from a hardcoded snapshot, so server-side renames degrade to the mirror instead of breaking the run. Failures classify as no-token, firewall, auth, or error, and the UI repeats that wording.
- `src/lib/binance/oauth.ts` does the workspace connect flow with PKCE and RFC 8414 style endpoint discovery. Env overrides `BINANCE_OAUTH_AUTHORIZE_URL` and `BINANCE_OAUTH_TOKEN_URL` win over discovery, and discovery wins over the documented fallback.
- `src/lib/server/connector-api.ts` serves `/api/binance/client-metadata`, `/connect`, `/callback`, `/status`, and `/disconnect`.
- `src/lib/binance/fns.ts` exposes the same state to React through `getAgentOsStatus`, `beginAgentOsConnect`, and `disconnectAgentOs`.
- `src/components/app/agent-os-connect.tsx` renders the badge and the connect control on every market check card.
- `scripts/agent-os-probe.ts` is the headless proof. `.mcp.json` is the one-step client wiring.

## Read-only guarantees

- Requested scopes are read-only market data and read-only account. No trade, transfer, or withdrawal scope exists anywhere in the code. Search for `scope` in `src/lib/binance` to confirm.
- Funds stay in a dedicated Agentic sub-account with withdrawals blocked, per the Agent OS model.
- The agent proposes. The trader decides. Output is a market impact assessment, never an order.

## Honest fallback

Binance edges server-side calls with a firewall challenge that only browser-driven MCP sessions pass reliably, and `api.binance.com` refuses US datacenter IPs outright. So public quotes flow through Binance's official geo-unrestricted mirror (`data-api.binance.vision`, the same data the MCP server exposes), and the readout badge says which path served it. A missing token never blocks a run.

## Demo script (60 seconds)

1. Ask: Watch NVDA, what is happening in the world that could materially change its value?
2. Point at the assessment cards: event, exposure path, evidence, invalidation.
3. Point at the market check card: thesis formed first, price consulted second.
4. Press Connect Agent OS, authorize, rerun. The badge flips from mirror to live.
5. Run `bun scripts/agent-os-probe.ts` for the headless proof.

## Submission checklist

- [ ] `.mcp.json` points at `https://www.binance.com/mcp/agentic`
- [ ] `bun scripts/agent-os-probe.ts` prints live tools with a token set
- [ ] In-app connect round-trips to `/app?binance=connected`
- [ ] Readout badge shows the true source on every run
- [ ] Video follows the demo script above
