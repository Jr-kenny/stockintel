import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { extractTicker, getQuotes } from "@/lib/binance/market";

/**
 * Live market context for a set of tickers. Public data — no key needed.
 * Returns one entry per ticker; entries without a Binance listing come
 * back with nulls (the UI shows a dash, never a guess).
 */
export const getMarketQuotes = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ tickers: z.array(z.string().max(40)).max(20) }).parse(input),
  )
  .handler(async ({ data }) => {
    const tickers = data.tickers.map(extractTicker).filter(Boolean);
    return getQuotes(tickers);
  });

/**
 * Agent OS connection state for the React UI. Read-only and non-throwing:
 * the probe reports live, firewall, auth, or no-token so the badge can
 * say what to do next. Pass the Privy identity (email or wallet).
 */
export const getAgentOsStatus = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ identity: z.string().min(1).max(160).optional() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { binanceConnectStatus, resolveAgentOsToken } = await import("@/lib/binance/oauth");
    const { agentOsStatus } = await import("@/lib/binance/agent-os");
    const state = data.identity ? await binanceConnectStatus(data.identity) : { connected: false };
    const token = await resolveAgentOsToken(data.identity ?? null);
    const probe = await agentOsStatus(token);
    return { ...state, probe, canConnect: !!data.identity };
  });

/** Start the Agent OS connect flow. Returns the Binance authorize URL. */
export const beginAgentOsConnect = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ identity: z.string().min(1).max(160) }).parse(input))
  .handler(async ({ data }) => {
    const { beginBinanceConnect } = await import("@/lib/binance/oauth");
    return beginBinanceConnect(data.identity);
  });

/** Revoke the workspace Agent OS token. */
export const disconnectAgentOs = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ identity: z.string().min(1).max(160) }).parse(input))
  .handler(async ({ data }) => {
    const { disconnectBinance } = await import("@/lib/binance/oauth");
    await disconnectBinance(data.identity);
    return { disconnected: true };
  });

export type HoldingView = { ticker: string; label: string };

/**
 * Holdings parsed out of the linked Agentic sub-account. Tickers come from
 * the same resolver the market check uses, so anything listed here can be
 * quoted and watched. Unconnected workspaces get an empty list, never an
 * error.
 */
export const getAgentOsHoldings = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ identity: z.string().min(1).max(160) }).parse(input))
  .handler(async ({ data }): Promise<{ connected: boolean; holdings: HoldingView[] }> => {
    const { resolveAgentOsToken } = await import("@/lib/binance/oauth");
    const token = await resolveAgentOsToken(data.identity);
    if (!token) return { connected: false, holdings: [] };
    const { agentOsAccount } = await import("@/lib/binance/agent-os");
    const { extractTicker } = await import("@/lib/binance/market");
    const lines = await agentOsAccount(token)
      .then((r) => r.lines)
      .catch(() => [] as string[]);
    const seen = new Set<string>();
    const holdings: HoldingView[] = [];
    for (const line of lines) {
      const ticker = extractTicker(line);
      if (!ticker || seen.has(ticker)) continue;
      seen.add(ticker);
      holdings.push({ ticker, label: line.slice(0, 90) });
    }
    return { connected: true, holdings: holdings.slice(0, 20) };
  });

/**
 * Import selected holdings as watchlist entries tagged Agent OS.
 * Rejects unknown tickers and skips anything already watched.
 */
export const importAgentOsHoldings = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        identity: z.string().min(1).max(160),
        tickers: z.array(z.string().min(1).max(12)).min(1).max(20),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ added: string[] }> => {
    const { db, ensureSchema, newId, nowIso } = await import("@/lib/db");
    const { supplyRecords } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const { extractTicker } = await import("@/lib/binance/market");
    await ensureSchema();
    const wanted = Array.from(
      new Set(data.tickers.map((t) => t.toUpperCase().replace(/[^A-Z]/g, "")).filter(Boolean)),
    ).slice(0, 20);
    if (wanted.length === 0) return { added: [] };
    const existing = await db
      .select()
      .from(supplyRecords)
      .where(eq(supplyRecords.identity, data.identity));
    const watched = new Set(existing.map((r) => extractTicker(r.name)).filter(Boolean));
    const added: string[] = [];
    for (const ticker of wanted) {
      if (watched.has(ticker)) continue;
      await db.insert(supplyRecords).values({
        id: newId("SUP"),
        name: `${ticker} (Agent OS holding)`,
        identity: data.identity,
        marketsJson: JSON.stringify(["Agent OS"]),
        targetsJson: JSON.stringify([]),
        createdAt: nowIso(),
      });
      watched.add(ticker);
      added.push(ticker);
    }
    return { added };
  });
