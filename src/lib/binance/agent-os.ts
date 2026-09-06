/**
 * Binance Agent OS MCP client — the real Agent OS path for Track A.
 *
 * Endpoint: https://agent.binance.com/mcp/agentic (Streamable HTTP), the
 * address from Binance's own launch announcement. Override with
 * AGENT_OS_MCP_URL only when Binance publishes a new address.
 *
 * Built on the official @modelcontextprotocol/sdk, not hand-rolled
 * JSON-RPC: the SDK owns session handling, event-stream parsing, and
 * structured content. Each call opens a stateless client, which is what a
 * serverless deployment can honour (no session affinity to lose).
 *
 * Auth: OAuth user authorization completed inside an MCP-compatible client
 * (Claude Code, Cursor, ChatGPT, Codex, VS Code): add the server URL there,
 * Authenticate in the browser, pick the agent, grant scopes. Server-side
 * calls present the workspace user token as a bearer. Market data needs no
 * special scope, balances and positions need the read-only account scope on
 * the Agentic sub-account. No withdrawals, ever. The app never requests
 * trade or transfer scopes.
 *
 * Tool names resolve from the server's own tools/list (matched by
 * keywords), never hardcoded to a snapshot, so server-side renames degrade
 * to the public REST mirror instead of breaking the run.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

const MCP_URL = process.env["AGENT_OS_MCP_URL"]?.trim() || "https://agent.binance.com/mcp/agentic";

function readEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

export function agentOsConfig(): { live: boolean; token: string } {
  const token = readEnv("BINANCE_MCP_TOKEN") ?? "";
  return { live: token.length > 10, token };
}

export type McpToolView = { name: string; description?: string };

let toolsCache: { at: number; token: string; tools: McpToolView[] } | null = null;
const TOOLS_TTL_MS = 10 * 60_000;

/** One stateless SDK client per call. Always closed, never throws raw. */
async function withClient<T>(
  token: string,
  fn: (client: Client) => Promise<T>,
  timeoutMs = 20_000,
): Promise<T> {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    },
  });
  const client = new Client({ name: "stockintel", version: "1.0.0" });
  try {
    // Cast: the transport's sessionId getter trips exactOptionalPropertyTypes.
    // Runtime shape is what the SDK expects.
    await client.connect(transport as unknown as Transport);
    return await fn(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function listTools(token: string): Promise<McpToolView[]> {
  if (toolsCache && toolsCache.token === token && Date.now() - toolsCache.at < TOOLS_TTL_MS) {
    return toolsCache.tools;
  }
  const tools = await withClient(
    token,
    async (client) => {
      const res = await client.listTools();
      return (res.tools ?? []).map((t) => ({
        name: t.name,
        ...(t.description ? { description: t.description } : {}),
      }));
    },
    15_000,
  );
  if (tools.length === 0) throw new Error("agent-os returned no tools");
  toolsCache = { at: Date.now(), token, tools };
  return tools;
}

function pickTool(tools: McpToolView[], names: string[]): string | null {
  const lower = tools.map((t) => ({ raw: t.name, n: t.name.toLowerCase() }));
  for (const want of names) {
    const hit = lower.find((t) => t.n.includes(want));
    if (hit) return hit.raw;
  }
  return null;
}

/** Prefer structured content, then JSON text, then raw text. */
function unwrapText(result: unknown): string {
  const r = result as {
    structuredContent?: unknown;
    content?: { type?: string; text?: string }[];
  };
  if (r?.structuredContent !== undefined) {
    return typeof r.structuredContent === "string"
      ? r.structuredContent
      : JSON.stringify(r.structuredContent);
  }
  const texts = (r?.content ?? [])
    .map((c) => (typeof c.text === "string" ? c.text : ""))
    .filter((t) => t.trim().length > 0);
  return texts.join("\n");
}

async function callTool(
  token: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<string> {
  const text = await withClient(token, async (client) => {
    const res = await client.callTool({ name: tool, arguments: args });
    return unwrapText(res);
  });
  if (!text.trim()) throw new Error(`agent-os ${tool} returned no content`);
  return text;
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
  const tools = await listTools(live);
  const tool = pickTool(tools, ["ticker", "price", "24hr", "24h"]);
  if (!tool) throw new Error("agent-os has no ticker tool");
  const text = await callTool(live, tool, { symbol });
  // Preference order: a last price beats an average every time.
  const priceMatch =
    /"?(?:lastPrice)"?\s*[:=]\s*"?([\d.]+)/i.exec(text) ??
    /"?(?:last|close|currentPrice)"?\s*[:=]\s*"?([\d.]+)/i.exec(text) ??
    /"?(?:price)"?\s*[:=]\s*"?([\d.]+)/i.exec(text);
  const price = Number(priceMatch?.[1]) || Number(/([\d]+\.[\d]+)/.exec(text)?.[1] ?? NaN);
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
  const tools = await listTools(live);
  const tool = pickTool(tools, ["kline", "candle", "klines", "candles", "ohlc"]);
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
  const tools = await listTools(live);
  const tool = pickTool(tools, ["account", "balance", "position", "portfolio"]);
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
  return (await listTools(live)).map((t) => t.name);
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
        "No Agent OS token. Set BINANCE_MCP_TOKEN from your own supported client session, or read on without one.",
    };
  }
  try {
    toolsCache = null;
    const tools = await listTools(live);
    return {
      live: true,
      tools: tools.map((t) => t.name),
      detail: `Agent OS live with ${tools.length} tools.`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/firewall|WAF|challenge/i.test(message)) {
      return {
        live: false,
        reason: "firewall",
        detail:
          "Edge firewall challenged the server-side call. Use your MCP client session instead. Public prices still flow through the mirror.",
      };
    }
    if (/auth|401|403|unauthorized|forbidden/i.test(message)) {
      return {
        live: false,
        reason: "auth",
        detail: "Token refused. Re-link your sub-account and retry.",
      };
    }
    return { live: false, reason: "error", detail: message.slice(0, 200) };
  }
}
