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
 * Agent OS source state for the UI badge. Read-only and non-throwing.
 * Binance only recognises its approved agent clients, so there is no
 * in-app authorize flow. Live context arrives through the shared server
 * key, otherwise the public mirror carries the read.
 */
export const getAgentOsStatus = createServerFn({ method: "POST" }).handler(async () => {
  const { resolveAgentOsToken } = await import("@/lib/binance/oauth");
  const { agentOsStatus } = await import("@/lib/binance/agent-os");
  const token = await resolveAgentOsToken(null);
  return { probe: await agentOsStatus(token) };
});

/**
 * Import pasted holdings as watchlist entries tagged Agent OS.
 * The workspace copies its balances out of its own Binance tools once,
 * picks what to watch, and research reads against it from then on.
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
