/**
 * Binance market context — the read-only half of the Agent OS market check.
 *
 * Public market data needs no key and comes straight from Binance REST
 * (the same data the Agent OS MCP server exposes). Authenticated calls
 * (account, positions, trading) unlock when BINANCE_API_KEY / SECRET are
 * set — see `./agent-os.ts`.
 */

// data-api.binance.vision is Binance official public-data mirror with no
// geo restrictions. api.binance.com refuses US IPs, which is where serverless
// functions run, so every public quote here goes through the mirror.
const REST_BASE = "https://data-api.binance.vision";
export let lastQuoteSource: "agent-os" | "mirror" = "mirror";

export type Quote = {
  ticker: string;
  symbol: string | null;
  price: number | null;
  change24hPct: number | null;
  volume24hQuote: number | null;
};

type Resolved = { symbol: string; price: number; change24hPct: number; volume24hQuote: number };

const cache = new Map<string, { at: number; value: Resolved | null }>();
const CACHE_TTL_MS = 30_000;

/** "NVDA (200 shares)" -> "NVDA". First letter-run, uppercased. */
export function extractTicker(name: string): string {
  const match = /^[A-Za-z]{1,12}/.exec(name.trim());
  return (match?.[0] ?? "").toUpperCase();
}

/** Company names we already know how to map to tickers. */
export function companyToTicker(name: string): string | null {
  return companyTickers(name)[0] ?? null;
}

/**
 * Every plausible ticker for a company name, best guess first. This is
 * symbol resolution, not investigation: each candidate is verified live
 * against Binance, and misses simply resolve to nothing. Nothing here
 * says what to investigate for any ticker. Works for any of the
 * thousands of listed names, not just the familiar ones.
 */
export function companyTickers(name: string): string[] {
  const out: string[] = [];
  const push = (t: string) => {
    const u = t.toUpperCase().replace(/[^A-Z]/g, "");
    if (u.length >= 1 && u.length <= 12 && !out.includes(u)) out.push(u);
  };
  const upper = name.trim().toUpperCase();
  if (KNOWN_COMPANIES[upper]) push(KNOWN_COMPANIES[upper]!);
  for (const [company, ticker] of Object.entries(KNOWN_COMPANIES)) {
    if (upper.includes(company)) {
      push(ticker);
      break;
    }
  }
  // Ticker hints authors leave in text: "Nebius Group (NBIS)", "NYSE:DELL".
  for (const m of name.matchAll(/\(([A-Z]{1,6})\)/g)) push(m[1]!);
  const exch = name.match(/(?:NYSE|NASDAQ|HKEX|TSE|KRX|LSE)\s*:\s*([A-Z0-9]{1,8})/i);
  if (exch?.[1]) push(exch[1]);
  const tokens = name
    .replace(/[^A-Za-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  for (const t of tokens) {
    const u = t.toUpperCase();
    if (!NAME_STOP.has(u) && !GENERIC_WORD.has(u)) push(u);
  }
  if (tokens.length >= 2 && tokens.length <= 5) {
    const initials = tokens.map((t) => t[0]!.toUpperCase()).join("");
    if (initials.length >= 2 && initials.length <= 5) push(initials);
  }
  const squashed = tokens.join("").toUpperCase();
  if (squashed.length >= 2) push(squashed);
  return out;
}
const GENERIC_WORD = new Set([
  "AI",
  "TECH",
  "BIG",
  "NEW",
  "GLOBAL",
  "TOP",
  "DATA",
  "MARKET",
  "STOCK",
  "CLOUD",
  "CHIP",
  "ALPHA",
  "BETA",
  "GAMMA",
  "OMEGA",
]);
const NAME_STOP = new Set([
  "GROUP",
  "HOLDINGS",
  "HOLDING",
  "INC",
  "CORP",
  "CORPORATION",
  "LTD",
  "LIMITED",
  "COMPANY",
  "COMPANIES",
  "CLASS",
  "PLC",
  "LLC",
  "NV",
  "SA",
  "AG",
  "AB",
]);
export const KNOWN_COMPANIES: Record<string, string> = {
  NVIDIA: "NVDA",
  TESLA: "TSLA",
  APPLE: "AAPL",
  MICROSOFT: "MSFT",
  AMAZON: "AMZN",
  META: "META",
  ALPHABET: "GOOGL",
  GOOGLE: "GOOGL",
  JPMORGAN: "JPM",
  BROADCOM: "AVGO",
  MICRON: "MU",
  DELL: "DELL",
  PALANTIR: "PLTR",
  TSMC: "TSM",
  "TAIWAN SEMICONDUCTOR": "TSM",
};

async function fetch24hr(symbol: string, mcpToken?: string | null): Promise<Resolved | null> {
  // Agent OS first (Track A path). Any failure falls through to the mirror.
  if (mcpToken) {
    try {
      const { agentOsTicker } = await import("./agent-os");
      const t = await agentOsTicker(symbol, mcpToken);
      lastQuoteSource = "agent-os";
      return { symbol, price: t.price, change24hPct: t.change24hPct, volume24hQuote: 0 };
    } catch {
      // fall through to mirror
    }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(`${REST_BASE}/api/v3/ticker/24hr?symbol=${symbol}`, {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      lastPrice?: string;
      priceChangePercent?: string;
      quoteVolume?: string;
    };
    const price = Number(j.lastPrice);
    if (!Number.isFinite(price)) return null;
    return {
      symbol,
      price,
      change24hPct: Number(j.priceChangePercent) || 0,
      volume24hQuote: Number(j.quoteVolume) || 0,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve a ticker to a Binance symbol. bStocks (tokenized equities like
 * NVDAB) are tried first, then plain USDT pairs (BTC, ETH, …).
 */
export async function resolveQuote(
  ticker: string,
  mcpToken?: string | null,
): Promise<Resolved | null> {
  const key = ticker.toUpperCase();
  if (!key) return null;
  // A workspace token changes the source, so never serve a cached mirror
  // quote as an Agent OS one or vice versa.
  const cacheKey = mcpToken ? `${key}|aos` : key;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    if (hit.value) lastQuoteSource = cacheKey.endsWith("|aos") ? "agent-os" : "mirror";
    return hit.value;
  }
  const candidates = key.endsWith("B")
    ? [`${key}USDT`, `${key.slice(0, -1)}BUSDT`]
    : [`${key}BUSDT`, `${key}USDT`];
  let value: Resolved | null = null;
  for (const symbol of candidates) {
    value = await fetch24hr(symbol, mcpToken);
    if (value) break;
  }
  cache.set(cacheKey, { at: Date.now(), value });
  return value;
}

export async function getQuotes(tickers: string[], mcpToken?: string | null): Promise<Quote[]> {
  const unique = Array.from(new Set(tickers.map((t) => t.toUpperCase()).filter(Boolean))).slice(
    0,
    20,
  );
  return Promise.all(
    unique.map(async (ticker) => {
      const r = await resolveQuote(ticker, mcpToken);
      return r
        ? {
            ticker,
            symbol: r.symbol,
            price: r.price,
            change24hPct: r.change24hPct,
            volume24hQuote: r.volume24hQuote,
          }
        : { ticker, symbol: null, price: null, change24hPct: null, volume24hQuote: null };
    }),
  );
}

export type CompanyMarket = { symbol: string; price: number; change24hPct: number };

/**
 * The live market check for a readout: map assessed companies to tickers,
 * snapshot Binance prices. Advisory only — throws nothing, resolves nulls.
 * Watchlist tickers ride along so the thesis reads against what the
 * workspace holds, and held lines say so out loud.
 */
export async function buildMarketSnapshot(
  companies: string[],
  question: string,
  identity?: string | null,
  holdings: string[] = [],
): Promise<{
  lines: string[];
  byCompany: Map<string, CompanyMarket>;
  source: "agent-os" | "mirror";
}> {
  const { agentOsTokenFor } = await import("./agent-os");
  const mcpToken = await agentOsTokenFor(identity ?? null);
  const tickers = new Set<string>();
  for (const name of companies) {
    // Try every candidate spelling; the first live Binance listing wins.
    for (const t of companyTickers(name).slice(0, 4)) {
      const r = await resolveQuote(t, mcpToken);
      if (r) {
        tickers.add(t);
        break;
      }
    }
  }
  const qTick = extractTicker(question.replace(/^watch\s+/i, ""));
  if (qTick) tickers.add(qTick);
  const held = new Set(
    holdings.map((t) => t.toUpperCase()).filter((t) => t.length >= 1 && t.length <= 12),
  );
  for (const t of held) tickers.add(t);
  const byCompany = new Map<string, CompanyMarket>();
  const lines: string[] = [];
  lastQuoteSource = "mirror";
  // Personal holdings arrive through the watchlist, which the snapshot
  // already marks. Shared context stays account-free.
  if (tickers.size === 0) return { lines, byCompany, source: lastQuoteSource };
  const quotes = await getQuotes([...tickers], mcpToken);
  for (const q of quotes) {
    if (!q.symbol || q.price === null) {
      lines.push(`${q.ticker}: no Binance listing`);
      continue;
    }
    const pct = q.change24hPct ?? 0;
    const heldMark = held.has(q.ticker) ? " · in your watchlist" : "";
    lines.push(
      `${q.ticker} (${q.symbol}): $${q.price.toFixed(2)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}% 24h)${heldMark}`,
    );
    for (const name of companies) {
      if (companyTickers(name).includes(q.ticker)) {
        byCompany.set(name, { symbol: q.symbol, price: q.price, change24hPct: pct });
      }
    }
  }
  return { lines, byCompany, source: lastQuoteSource };
}
