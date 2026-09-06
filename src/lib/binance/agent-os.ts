/**
 * Binance Agent OS MCP client — the real Agent OS path for Track A.
 *
 * Endpoint: https://www.binance.com/mcp/agentic (Streamable HTTP).
 * Verified Sept 2026: binance.com/mcp/agentic 301-redirects here, while
 * agent.binance.com/mcp/agentic returns 404. Override with AGENT_OS_MCP_URL
 * only when Binance publishes a new address.
 *
 * Auth: OAuth user authorization completed inside an MCP-compatible client
 * (Claude Code, Cursor, ChatGPT, Codex): add the server URL there,
 * Authenticate in the browser, pick the agent, grant scopes. There is no
 * static token to paste and no web page at that URL.
 * Server-side calls use BINANCE_MCP_TOKEN when a user token exists, e.g.
 * from the client auth flow above. Connect from an MCP client
 * (Claude Code: claude mcp add binance-mcp-server --transport http
 * https://www.binance.com/mcp/agentic, then /mcp Authenticate),
 * market data needs no special scope, balances and positions need the
 * read-only account scope on your Agentic sub-account. No withdrawals,
 * ever. The app never requests trade or transfer scopes.
 *
 * Tool names are resolved from the server's own tools/list (matched by
 * keywords), never hardcoded to a snapshot, so server-side renames degrade
 * to the public REST mirror instead of breaking the run.
 */

const MCP_URL = process.env["AGENT_OS_MCP_URL"]?.trim() || "https://www.binance.com/mcp/agentic";

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
    if (res.headers.get("x-amzn-waf-action") === "challenge" || res.status === 202) {
      throw new Error(
        "agent-os challenged by edge firewall (WAF). Connect from an MCP client browser flow instead.",
      );
    }
    if (res.status === 401 || res.status === 403) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `agent-os auth refused (${res.status}). Re-authenticate in your MCP client. ${body.slice(0, 80)}`,
      );
    }
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
  await rpc(token, "notifications/initialized", {}, 10_000).catch(() => undefined);
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

/** Resolve the usable token: explicit workspace token first, env fallback. */
export async function agentOsTokenFor(identity?: string | null): Promise<string | null> {
  if (identity) {
    const { resolveAgentOsToken } = await import("./oauth");
    const t = await resolveAgentOsToken(identity);
    if (t) return t;
  }
  const { token } = agentOsConfig();
  return token || null;
}

/** 24h ticker via Agent OS MCP. Throws when unavailable; callers fall back. */
export async function agentOsTicker(
  symbol: string,
  token?: string | null,
): Promise<{ price: number; change24hPct: number }> {
  const live = token ?? agentOsConfig().token;
  if (!live) throw new Error("agent-os not configured (no workspace token)");
  await ensureSession(live);
  const tool = pickTool(["ticker", "price", "24hr", "24h"]);
  if (!tool) throw new Error("agent-os has no ticker tool");
  const text = await callTool(live, tool, { symbol });
  const price =
    Number(/"?(?:lastPrice|price|last)"?\s*[:=]\s*"?([\d.]+)/i.exec(text)?.[1]) ||
    Number(/([\d]+\.[\d]+)/.exec(text)?.[1] ?? NaN);
  const pct =
    Number(
      /"?(?:priceChangePercent|changePercent|change24h)"?\s*[:=]\s*"?([+-]?[\d.]+)/i.exec(
        text,
      )?.[1] ?? NaN,
    ) || 0;
  if (!Number.isFinite(price)) throw new Error("agent-os ticker unparseable");
  return { price, change24hPct: pct };
}

/** Daily candles via Agent OS MCP. Throws when unavailable; callers fall back. */
export async function agentOsKlines(
  symbol: string,
  limit = 120,
  token?: string | null,
): Promise<{ time: number; open: number; high: number; low: number; close: number }[]> {
  const live = token ?? agentOsConfig().token;
  if (!live) throw new Error("agent-os not configured (no workspace token)");
  await ensureSession(live);
  const tool = pickTool(["kline", "candle", "klines", "candles", "ohlc"]);
  if (!tool) throw new Error("agent-os has no klines tool");
  const text = await callTool(live, tool, { symbol, interval: "1d", limit });
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
              time: Number(o["time"] ?? o["openTime"] ?? o["t"] ?? 0),
              open: Number(o["open"] ?? o["o"] ?? NaN),
              high: Number(o["high"] ?? o["h"] ?? NaN),
              low: Number(o["low"] ?? o["l"] ?? NaN),
              close: Number(o["close"] ?? o["c"] ?? NaN),
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
export async function agentOsAccount(token?: string | null): Promise<{ lines: string[] }> {
  const live = token ?? agentOsConfig().token;
  if (!live) throw new Error("agent-os not configured (no workspace token)");
  await ensureSession(live);
  const tool = pickTool(["account", "balance", "position", "portfolio"]);
  if (!tool) throw new Error("agent-os has no account tool");
  const text = await callTool(live, tool, {});
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 12);
  if (lines.length === 0) throw new Error("agent-os account empty");
  return { lines };
}

/** For diagnostics and the UI badge: which tools the server exposes. */
export async function agentOsToolNames(token?: string | null): Promise<string[]> {
  const live = token ?? agentOsConfig().token;
  await ensureSession(live);
  return (toolsCache ?? []).map((t) => t.name);
}

export type AgentOsStatus =
  | { live: true; tools: string[]; detail: string }
  | { live: false; reason: "no-token" | "firewall" | "auth" | "error"; detail: string };

/**
 * Non-throwing probe for the status badge, the probe script, and judges.
 * Never throws. Distinguishes missing token from firewall and auth faults
 * so the UI can say what to do next instead of guessing.
 */
export async function agentOsStatus(token?: string | null): Promise<AgentOsStatus> {
  const live = token ?? agentOsConfig().token;
  if (!live) {
    return {
      live: false,
      reason: "no-token",
      detail:
        "No Agent OS token. Add the MCP server in your MCP client and authenticate, or set BINANCE_MCP_TOKEN.",
    };
  }
  try {
    // Drop any cached session so the probe reports the truth now, not last run.
    sessionId = undefined;
    await ensureSession(live);
    const tools = (toolsCache ?? []).map((t: { name: string }) => t.name);
    return { live: true, tools, detail: `Agent OS live with ${tools.length} tools.` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/firewall|WAF/i.test(message)) {
      return {
        live: false,
        reason: "firewall",
        detail:
          "Edge firewall challenged the server-side call. Use your MCP client session instead. Public prices still flow through the mirror.",
      };
    }
    if (/auth refused|401|403|unauthorized/i.test(message)) {
      return {
        live: false,
        reason: "auth",
        detail: "Token refused. Re-authenticate in your MCP client and retry.",
      };
    }
    return { live: false, reason: "error", detail: message.slice(0, 200) };
  }
}
