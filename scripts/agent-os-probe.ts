/**
 * Agent OS probe — the two-minute Track A check.
 *
 *   bun scripts/agent-os-probe.ts [SYMBOL]
 *
 * Read-only. Resolves tool names from the server's own tools/list, prints
 * the connection state, and when live, one ticker plus the tool catalog.
 * Without a token it reports the honest fallback state instead of failing.
 * Never prints the token itself.
 */

import {
  agentOsConfig,
  agentOsStatus,
  agentOsTicker,
  agentOsToolNames,
} from "../src/lib/binance/agent-os.ts";

const MCP_URL = process.env["AGENT_OS_MCP_URL"]?.trim() || "https://www.binance.com/mcp/agentic";
const symbol = (process.argv[2] ?? "BTCUSDT").toUpperCase();

async function main() {
  console.log(`endpoint: ${MCP_URL}`);
  const { live, token } = agentOsConfig();
  console.log(`token: ${live ? `present (${token.length} chars)` : "absent"}`);

  const status = await agentOsStatus();
  if (!status.live) {
    console.log(`status: fallback (${status.reason})`);
    console.log(`detail: ${status.detail}`);
    return;
  }
  console.log(`status: live`);
  console.log(`detail: ${status.detail}`);

  try {
    const tools = await agentOsToolNames();
    console.log(`tools (${tools.length}): ${tools.slice(0, 20).join(", ")}`);
  } catch (err) {
    console.log(`tools: unavailable (${err instanceof Error ? err.message : err})`);
  }

  try {
    const t = await agentOsTicker(symbol);
    const sign = t.change24hPct >= 0 ? "+" : "";
    console.log(`${symbol}: $${t.price} (${sign}${t.change24hPct.toFixed(2)}% 24h) via Agent OS`);
  } catch (err) {
    console.log(`ticker ${symbol}: unavailable (${err instanceof Error ? err.message : err})`);
  }
}

await main();
