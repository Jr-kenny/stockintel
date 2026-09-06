/**
 * StockIntel as an MCP server — the other half of the Agent OS workflow.
 *
 * Binance's MCP server only accepts its approved agent clients, so the
 * connection stays where it belongs: in the calling agent's own session.
 * StockIntel joins that session as a second MCP server:
 *
 *   Claude Code ── binance-mcp-server ──> Binance (market data, execution)
 *               └─ stockintel ──────────> event thesis + market read
 *
 * The calling agent fetches the exchange leg with its own authorised
 * Binance tools and passes it into stockintel_read as binance_market_data.
 * That leg reports provenance caller-supplied. Omitted, and StockIntel
 * resolves the same public numbers itself through Agent OS or the mirror.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { marketRead } from "@/lib/binance/read";

const MCP_AGENT_OS_URL =
  process.env["AGENT_OS_MCP_URL"]?.trim() || "https://agent.binance.com/mcp/agentic";

function appBase(): string {
  const raw =
    process.env["PUBLIC_APP_URL"]?.trim() ||
    process.env["PUBLIC_SUBMIT_URL"]?.trim() ||
    "https://stockintel-eight.vercel.app";
  return raw.replace(/\/+$/, "");
}

/** Short text first (agents pay per token), full shape as structured content. */
function summarize(
  quotes: {
    ticker: string;
    price: number | null;
    change24hPct: number | null;
    provenance: string;
  }[],
): string {
  return quotes
    .map((q) =>
      q.price === null
        ? `${q.ticker}: no Binance listing`
        : `${q.ticker}: $${q.price.toFixed(2)} (${(q.change24hPct ?? 0) >= 0 ? "+" : ""}${(q.change24hPct ?? 0).toFixed(2)}% 24h) via ${q.provenance}`,
    )
    .join("\n");
}

export function buildStockintelMcpServer(): McpServer {
  const server = new McpServer(
    { name: "stockintel", version: "1.0.0" },
    {
      instructions:
        "StockIntel is event-driven equity intelligence: name a ticker and it investigates the world " +
        "behind it, then checks the thesis against live market context. When you also have the Binance " +
        "MCP Server connected, fetch the exchange leg with it first and pass those tool results into " +
        "stockintel_read as binance_market_data; that makes the market side come through your own " +
        "authorised Binance session. StockIntel proposes assessments, never trade instructions.",
    },
  );

  server.registerTool(
    "stockintel_read",
    {
      title: "Market read with thesis context",
      description:
        "Live market read for up to 20 tickers: price, 24h move, volume, and the positioning gauge " +
        "(range position, 14-session run, daily wobble) behind each line. Read-only. No key needed.",
      inputSchema: {
        tickers: z
          .array(z.string().max(40))
          .min(1)
          .max(20)
          .describe("Tickers to read, e.g. NVDA, MU, DELL."),
        binance_market_data: z
          .unknown()
          .optional()
          .describe(
            "Optional. The raw output of your OWN Binance MCP Server market-data tools for these " +
              "tickers. Paste the tool results verbatim. StockIntel reads price and 24h change out of " +
              "them and marks that leg caller-supplied. Omit it and StockIntel resolves the same " +
              "public numbers itself.",
          ),
        identity: z
          .string()
          .max(160)
          .optional()
          .describe(
            "Optional. A StockIntel workspace identity; unlocks that workspace's watchlist marks.",
          ),
      },
    },
    async ({ tickers, binance_market_data, identity }) => {
      const { quotes } = await marketRead({
        tickers,
        ...(binance_market_data !== undefined ? { marketData: binance_market_data } : {}),
        ...(identity ? { identity } : {}),
      });
      const payload = { quotes };
      return {
        content: [{ type: "text" as const, text: summarize(quotes) }],
        structuredContent: payload,
      };
    },
  );

  server.registerTool(
    "stockintel_status",
    {
      title: "StockIntel status",
      description:
        "Whether this deployment holds its own Agent OS session, which MCP endpoint it uses, and the HTTP base URL of the same services.",
      inputSchema: {},
    },
    async () => {
      const { agentOsStatus, agentOsTokenFor } = await import("@/lib/binance/agent-os");
      const token = await agentOsTokenFor(null).catch(() => null);
      const probe = await agentOsStatus(token);
      const payload = {
        service: "stockintel",
        agent_os_mcp_url: MCP_AGENT_OS_URL,
        http_base_url: appBase(),
        own_mcp_session: probe.live
          ? { live: true, tools: probe.tools.length }
          : { live: false, reason: probe.reason },
        note: "Market data needs no key. Pass your Binance MCP tool output as binance_market_data and the market leg comes through YOUR session.",
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    },
  );

  server.registerTool(
    "stockintel_assess",
    {
      title: "Thesis assessment",
      description:
        "The full StockIntel thesis for a ticker: preamble plus one assessment per exposure with " +
        "verdict (priced, underpriced, unclear), market call, timeframe, and sources. Served from " +
        "the latest completed investigation. Read-only, no key needed.",
      inputSchema: {
        ticker: z.string().max(12).describe("Ticker to assess, e.g. NVDA."),
      },
    },
    async ({ ticker }) => {
      const { agentAssess } = await import("@/lib/orchestrator/agent-read");
      const a = await agentAssess(ticker);
      const text = a.found
        ? [
            a.preamble,
            ...a.recommendations.map(
              (r) => `${r.company} (${r.verdict}, ${r.confidence}%): ${r.marketCall} [${r.timeframe}]`,
            ),
            `Assessed ${a.assessedAt}.`,
          ]
            .filter(Boolean)
            .join("\n")
        : `No completed assessment for ${a.ticker} yet. Run a watch in the app first.`;
      return {
        content: [{ type: "text" as const, text }],
        structuredContent: a,
      };
    },
  );

  server.registerTool(
    "stockintel_clusters",
    {
      title: "Evidence clusters",
      description:
        "Grouped evidence per exposure for a ticker: claims, independent source count, top claim, " +
        "sources, and contributing agents. No thesis, no verdicts. Served from the latest completed " +
        "investigation. Read-only, no key needed.",
      inputSchema: {
        ticker: z.string().max(12).describe("Ticker to cluster, e.g. NVDA."),
      },
    },
    async ({ ticker }) => {
      const { agentClusters } = await import("@/lib/orchestrator/agent-read");
      const c = await agentClusters(ticker);
      const text = c.found
        ? c.clusters
            .map(
              (e) =>
                `${e.company} [${e.confidence}%]: ${e.topClaim} (${e.independentSources} independent sources)`,
            )
            .join("\n")
        : `No completed clusters for ${c.ticker} yet. Run a watch in the app first.`;
      return {
        content: [{ type: "text" as const, text }],
        structuredContent: c,
      };
    },
  );

  return server;
}

/**
 * Handle one Streamable HTTP request. Stateless: a fresh server and
 * transport per request, which is what a serverless deployment behind a
 * load balancer can actually honour.
 */
export async function handleMcpRequest(request: Request): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });
  const server = buildStockintelMcpServer();
  await server.connect(transport);
  const response = await transport.handleRequest(request);
  response.headers.set("Access-Control-Allow-Origin", "*");
  return response;
}
