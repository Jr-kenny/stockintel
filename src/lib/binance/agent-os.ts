/**
 * Binance Agent OS MCP client — the real Agent OS path for Track A.
 *
 * Endpoint: https://agent.binance.com/mcp/agentic (Streamable HTTP).
 * Auth: OAuth user authorization completed inside an MCP-compatible client
 * (Claude Code, Cursor, Claude Desktop): add the server URL there,
 * Authenticate in the browser, pick the agent, grant scopes. There is no
 * static token to paste and no web page at that URL.
 * Server-side calls use BINANCE_MCP_TOKEN when a user token exists, e.g.
 * from the client auth flow above. Connect from an MCP client
 * (Claude Code: claude mcp add binance-mcp-server --transport http
 * https://agent.binance.com/mcp/agentic, then /mcp Authenticate),
 * market data needs no special scope, balances and positions need the
 * market data needs no special scope, balances and positions need the
 * read-only account scope on your Agentic sub-account. No withdrawals,
 * ever — the app never requests trade or transfer scopes.
 *
 * Tool names are resolved from the server's own tools/list (matched by
 * keywords), never hardcoded to a snapshot, so server-side renames degrade
 * to the public REST mirror instead of breaking the run.
 */

const MCP_URL =
  process.env["AGENT_OS_MCP_URL"]?.trim() || "https://agent.binance.com/mcp/agentic";

function readEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

export function agentOsConfig(): { live: boolean; token: string } {
  const token = readEnv("BINANCE_MCP_TOKEN") ?? "";
  return { live: token.length > 10, token };
}

type RpcResult = {
  result?: {
    tools?: { name: string; description?: string; inputSchema?: unknown }[];
    content?: { type?: string; text?: string }[];
    [k: string]: unknown;
  };
  error?: { code?: number; message?: string };
};

let sessionId: string | undefined;
let toolsCache: { name: string; description?: string }[] | null = null;

async function rpc(
  token: string,
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number,
): Promise<RpcResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      Accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
    };
    if (sessionId) headers["Mcp-Session-Id"] = sessionId;
    const res = await fetch(MCP_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
      signal: controller.signal,
    });
    const sid = res.headers.get("Mcp-Session-Id") ?? res.headers.get("mcp-session-id");
    if (sid) sessionId = sid;
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`agent-os ${res.status}: ${body.slice(0, 160)}`);
    }
    const text = await res.text();
    // Streamable HTTP may wrap the JSON-RPC payload in SSE data frames.
    const jsonLine =
      text
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.startsWith("data:"))
        ?.slice(5)
        .trim() ?? text;
    return JSON.parse(jsonLine) as RpcResult;
  } finally {
    clearTimeout(timer);
  }
}

async function ensureSession(token: string): Promise<void> {
  if (!token) throw new Error("agent-os not configured (no BINANCE_MCP_TOKEN)");
  if (sessionId && toolsCache) return;
  const init = await rpc(
    token,
    "initialize",
    {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "stockintel", version: "1.0.0" },
    },
    15_000,
  );
  if (init.error) throw new Error(`agent-os init: ${init.error.message ?? init.error.code}`);
  // Best-effort initialized notification; failures here are non-fatal.
  await rpc(token, "notifications/initialized", {}).catch(() => undefined);
  const listed = await rpc(token, "tools/list", {}, 15_000);
  if (listed.error) throw new Error(`agent-os tools: ${listed.error.message ?? listed.error.code}`);
  toolsCache = (listed.result?.tools ?? []).map((t) => ({
    name: t.name,
    ...(t.description ? { description: t.description } : {}),
  }));
  if (toolsCache.length === 0) throw new Error("agent-os returned no tools");
}

function pickTool(names: string[]): string | null {
  if (!toolsCache) return null;
  const lower = toolsCache.map((t) => ({ raw: t.name, n: t.name.toLowerCase() }));
  for (const want of names) {
    const hit = lower.find((t) => t.n.includes(want));
    if (hit) return hit.raw;
  }
  return null;
}

async function callTool(
  token: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<string> {
  const res = await rpc(token, "tools/call", { name: tool, arguments: args }, 20_000);
  if (res.error) throw new Error(`agent-os ${tool}: ${res.error.message ?? res.error.code}`);
  const content = res.result?.content ?? [];
  const texts = content
    .map((c) => (typeof c.text === "string" ? c.text : ""))
    .filter((t) => t.trim().length > 0);
  if (texts.length === 0) throw new Error(`agent-os ${tool} returned no content`);
  return texts.join("\n");
}

/** 24h ticker via Agent OS MCP. Throws when unavailable; callers fall back. */
export async function agentOsTicker(
  symbol: string,
): Promise<{ price: number; change24hPct: number }> {
  const { token } = agentOsConfig();
  await ensureSession(token);
  const tool = pickTool(["ticker", "price", "24hr", "24h"]);
  if (!tool) throw new Error("agent-os has no ticker tool");
  const text = await callTool(token, tool, { symbol });
  const price =
    Number(/"?(?:lastPrice|price|last)"?\s*[:=]\s*"?([\d.]+)/i.exec(text)?.[1]) ||
    Number(/([\d]+\.[\d]+)/.exec(text)?.[1] ?? NaN);
  const pct =
    Number(/"?(?:priceChangePercent|changePercent|change24h)"?\s*[:=]\s*"?([+-]?[\d.]+)/i.exec(text)?.[1] ?? NaN) || 0;
  if (!Number.isFinite(price)) throw new Error("agent-os ticker unparseable");
  return { price, change24hPct: pct };
}

/** Daily candles via Agent OS MCP. Throws when unavailable; callers fall back. */
export async function agentOsKlines(
  symbol: string,
  limit = 120,
): Promise<{ time: number; open: number; high: number; low: number; close: number }[]> {
  const { token } = agentOsConfig();
  await ensureSession(token);
  const tool = pickTool(["kline", "candle", "klines", "candles", "ohlc"]);
  if (!tool) throw new Error("agent-os has no klines tool");
  const text = await callTool(token, tool, { symbol, interval: "1d", limit });
  const rows: { time: number; open: number; high: number; low: number; close: number }[] = [];
  // Accept both array-of-arrays and array-of-objects serializations.
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try {
      const parsed = JSON.parse(arrMatch[0]) as unknown;
      if (Array.isArray(parsed)) {
        for (const r of parsed) {
          if (Array.isArray(r) && r.length >= 5) {
            const c = {
              time: Number(r[0]),
              open: Number(r[1]),
              high: Number(r[2]),
              low: Number(r[3]),
              close: Number(r[4]),
            };
            if ([c.open, c.high, c.low, c.close].every(Number.isFinite)) rows.push(c);
          } else if (r && typeof r === "object") {
            const o = r as Record<string, unknown>;
            const c = {
              time: Number(o.time ?? o.openTime ?? o.t ?? 0),
              open: Number(o.open ?? o.o ?? NaN),
              high: Number(o.high ?? o.h ?? NaN),
              low: Number(o.low ?? o.l ?? NaN),
              close: Number(o.close ?? o.c ?? NaN),
            };
            if ([c.open, c.high, c.low, c.close].every(Number.isFinite)) rows.push(c);
          }
        }
      }
    } catch {
      // fall through to empty
    }
  }
  if (rows.length === 0) throw new Error("agent-os klines unparseable");
  return rows;
}

/** Read-only account snapshot via Agent OS MCP (Agentic sub-account). */
export async function agentOsAccount(): Promise<{ lines: string[] }> {
  const { token } = agentOsConfig();
  await ensureSession(token);
  const tool = pickTool(["account", "balance", "position", "portfolio"]);
  if (!tool) throw new Error("agent-os has no account tool");
  const text = await callTool(token, tool, {});
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 12);
  if (lines.length === 0) throw new Error("agent-os account empty");
  return { lines };
}

/** For diagnostics and the UI badge: which tools the server exposes. */
export async function agentOsToolNames(): Promise<string[]> {
  const { token } = agentOsConfig();
  await ensureSession(token);
  return (toolsCache ?? []).map((t) => t.name);
}
