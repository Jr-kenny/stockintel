/**
 * Caller-supplied market context — the calling agent's own Binance MCP
 * session, borrowed.
 *
 * Binance's MCP server only accepts its approved agent clients, so an
 * outside agent calling StockIntel brings the exchange leg with it: it
 * fetches market data with its own authorised Binance tools and passes the
 * tool output here verbatim. Shapes vary by tool and client, so nothing is
 * positional. Every field is found by name, through arrays and common
 * wrappers. A payload that yields no price is rejected, never half-read.
 *
 * Provenance is always reported as caller-supplied. StockIntel sees a
 * payload arrive from the caller. It cannot verify where the caller got it,
 * so it never claims otherwise.
 */

type Json = unknown;

const asNumber = (v: unknown): number | null => {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Every object in the payload, flattened through arrays and wrappers. */
function objects(payload: Json, depth = 0): Record<string, unknown>[] {
  if (payload == null || depth > 4) return [];
  if (typeof payload === "string") {
    try {
      return objects(JSON.parse(payload) as Json, depth + 1);
    } catch {
      return [];
    }
  }
  if (Array.isArray(payload)) return payload.flatMap((p) => objects(p, depth + 1));
  if (typeof payload !== "object") return [];
  const rec = payload as Record<string, unknown>;
  const nested = [
    "data",
    "result",
    "content",
    "structuredContent",
    "ticker",
    "payload",
    "items",
    "text",
  ].flatMap((k) => (rec[k] !== undefined ? objects(rec[k], depth + 1) : []));
  return [rec, ...nested];
}

/** First numeric value whose key matches, optionally scoped to a symbol. */
function pick(objs: Record<string, unknown>[], names: RegExp, symbol?: string): number | null {
  const scoped = symbol
    ? objs.filter(
        (o) =>
          o["symbol"] === undefined || String(o["symbol"]).toUpperCase() === symbol.toUpperCase(),
      )
    : objs;
  for (const o of scoped) {
    for (const [k, v] of Object.entries(o)) {
      if (names.test(k)) {
        const n = asNumber(v);
        if (n !== null) return n;
      }
    }
  }
  return null;
}

/** Price keys in preference order. Averages never beat a last price. */
const PRICE_KEYS = ["lastPrice", "last", "close", "currentPrice", "price", "weightedAvgPrice"];

/** First price found walking the preference order, optionally scoped to a symbol. */
function pickPrice(objs: Record<string, unknown>[], symbol?: string): number | null {
  const scoped = symbol
    ? objs.filter((o) => o["symbol"] === undefined || String(o["symbol"]).toUpperCase() === symbol.toUpperCase())
    : objs;
  for (const key of PRICE_KEYS) {
    for (const o of scoped) {
      for (const [k, v] of Object.entries(o)) {
        if (k.toLowerCase() === key.toLowerCase()) {
          const n = asNumber(v);
          if (n !== null) return n;
        }
      }
    }
  }
  return null;
}

function pickSymbol(objs: Record<string, unknown>[]): string | null {  for (const o of objs) {
    for (const [k, v] of Object.entries(o)) {
      if (/^(symbol|pair|instrument)$/i.test(k) && typeof v === "string" && v.trim()) {
        return v.trim().toUpperCase();
      }
    }
  }
  return null;
}

export type SuppliedQuote = {
  ticker: string;
  symbol: string | null;
  price: number | null;
  change24hPct: number | null;
  volume24hQuote: number | null;
};

/**
 * Read one quote out of a caller-supplied MCP payload. Returns null when no
 * price is present. Provenance stays caller-supplied all the way up.
 */
export function quoteFromMcpPayload(payload: Json, fallbackTicker?: string): SuppliedQuote | null {
  const objs = objects(payload);
  if (objs.length === 0) return null;
  const symbol = pickSymbol(objs) ?? fallbackTicker?.toUpperCase() ?? "";
  if (!symbol) return null;
  const price = pickPrice(objs, symbol);
  if (price === null) return null;
  return {
    ticker: fallbackTicker?.toUpperCase() ?? symbol.replace(/USDT$|BUSDT$/, ""),
    symbol,
    price,
    change24hPct: pick(
      objs,
      /^(priceChangePercent|percentChange24h|change24h|changePercent|priceChangePct)$/i,
      symbol,
    ),
    volume24hQuote: pick(
      objs,
      /^(quoteVolume|quoteVolume24h|volumeUsd|turnover|quoteAssetVolume)$/i,
      symbol,
    ),
  };
}
