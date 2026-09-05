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
