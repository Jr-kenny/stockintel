/**
 * Shared market read behind both call methods for outside agents: plain
 * HTTP and our own MCP server. One shape in, one shape out, so the two
 * surfaces can never drift apart.
 *
 * Each ticker resolves caller-supplied first (the calling agent's own
 * Binance MCP output, provenance caller-supplied), then live Agent OS,
 * then the public mirror. Provenance travels with every quote.
 */

import { lastQuoteSource, resolveQuote } from "./market";
import { getKlines, positioningGauge } from "./market-test";
import { quoteFromMcpPayload } from "./inject";

export type ReadQuote = {
  ticker: string;
  symbol: string | null;
  price: number | null;
  change24hPct: number | null;
  volume24hQuote: number | null;
  provenance: "caller-supplied" | "agent-os" | "mirror";
  lines: string[];
};

function quoteLine(
  ticker: string,
  symbol: string | null,
  price: number | null,
  pct: number | null,
  provenance: ReadQuote["provenance"],
): string {
  if (!symbol || price === null) return `${ticker}: no Binance listing`;
  const p = pct ?? 0;
  return `${ticker} (${symbol}): $${price.toFixed(2)} (${p >= 0 ? "+" : ""}${p.toFixed(2)}% 24h) via ${provenance}`;
}

async function gaugeLines(symbol: string, mcpToken: string | null): Promise<string[]> {
  try {
    const candles = await getKlines(symbol, 120, mcpToken);
    return positioningGauge(symbol, candles).map((g) => `${g.label}: ${g.detail}`);
  } catch {
    return [];
  }
}

/**
 * Market read for up to 20 tickers. Never throws on a ticker, resolves
 * nulls. Needs no key: public data flows without one.
 */
export async function marketRead(input: {
  tickers: string[];
  marketData?: unknown;
  identity?: string | null;
}): Promise<{ quotes: ReadQuote[] }> {
  const { agentOsTokenFor } = await import("./agent-os");
  const mcpToken = await agentOsTokenFor(input.identity ?? null).catch(() => null);
  const tickers = Array.from(
    new Set(input.tickers.map((t) => t.toUpperCase().replace(/[^A-Z]/g, "")).filter(Boolean)),
  ).slice(0, 20);

  const quotes: ReadQuote[] = [];
  for (const ticker of tickers) {
    // The calling agent's own session first.
    if (input.marketData !== undefined) {
      try {
        const supplied = quoteFromMcpPayload(input.marketData, ticker);
        if (supplied && supplied.price !== null) {
          const lines = [
            quoteLine(
              ticker,
              supplied.symbol,
              supplied.price,
              supplied.change24hPct,
              "caller-supplied",
            ),
          ];
          if (supplied.symbol) {
            for (const g of await gaugeLines(supplied.symbol, mcpToken)) lines.push(g);
          }
          quotes.push({ ...supplied, ticker, provenance: "caller-supplied", lines });
          continue;
        }
      } catch {
        // fall through to live resolution
      }
    }
    const r = await resolveQuote(ticker, mcpToken).catch(() => null);
    if (!r) {
      quotes.push({
        ticker,
        symbol: null,
        price: null,
        change24hPct: null,
        volume24hQuote: null,
        provenance: "mirror",
        lines: [quoteLine(ticker, null, null, null, "mirror")],
      });
      continue;
    }
    const provenance = lastQuoteSource;
    const lines = [quoteLine(ticker, r.symbol, r.price, r.change24hPct, provenance)];
    for (const g of await gaugeLines(r.symbol, mcpToken)) lines.push(g);
    quotes.push({ ...r, ticker, provenance, lines });
  }
  return { quotes };
}
