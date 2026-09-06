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
    return { ...state, probe };
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
