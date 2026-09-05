import { getQuotes } from "./market";

/**
 * Market test — the quantitative half of "already priced?".
 *
 * The thesis says what SHOULD happen. This module measures where price
 * already IS: range position, recent run-up, daily wobble. It never emits
 * verdicts; synthesis weighs these measurements against the causal chain.
 * Additional tests (reverse-DCF once fundamentals arrive, volume regime,
 * peer-relative strength) slot in as functions returning `GaugeLine[]`.
 */

export type Candle = { time: number; open: number; high: number; low: number; close: number };

export type GaugeLine = { label: string; detail: string };

const REST_BASE = "https://api.binance.com";

export async function getKlines(symbol: string, limit = 120): Promise<Candle[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(
      `${REST_BASE}/api/v3/klines?symbol=${symbol}&interval=1d&limit=${Math.min(365, Math.max(14, limit))}`,
      { signal: controller.signal },
    );
    if (!res.ok) return [];
    const rows = (await res.json()) as unknown[][];
    return rows
      .map((r) => ({
        time: r[0] as number,
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
      }))
      .filter((c) => [c.open, c.high, c.low, c.close].every(Number.isFinite));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function pct(a: number, b: number): number {
  return b === 0 ? 0 : ((a - b) / Math.abs(b)) * 100;
}

/** Positioning gauge from daily candles. Pure measurement, no verdict. */
export function positioningGauge(symbol: string, candles: Candle[]): GaugeLine[] {
  if (candles.length < 15) return [];
  const closes = candles.map((c) => c.close);
  const last = closes[closes.length - 1]!;
  const high = Math.max(...candles.map((c) => c.high));
  const low = Math.min(...candles.map((c) => c.low));
  const span = high - low;
  const rangePos = span <= 0 ? 50 : ((last - low) / span) * 100;
  const ref14 = closes[Math.max(0, closes.length - 15)]!;
  const run14 = pct(last, ref14);
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) rets.push(pct(closes[i]!, closes[i - 1]!));
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const wobble = Math.sqrt(rets.reduce((s, r) => s + (r - mean) ** 2, 0) / rets.length);
  const days = candles.length;
  const lines: GaugeLine[] = [
    {
      label: "Range position",
      detail: `${symbol} sits at ${rangePos.toFixed(0)}% of its ${days}d range (low $${low.toFixed(2)}, high $${high.toFixed(2)}).`,
    },
    {
      label: "Recent run",
      detail: `${run14 >= 0 ? "+" : ""}${run14.toFixed(1)}% over the last 14 sessions.`,
    },
    {
      label: "Daily wobble",
      detail: `Typical daily move ±${wobble.toFixed(1)}%. Moves inside this band are noise; moves beyond it demand an explanation.`,
    },
  ];
  if (rangePos >= 80 && run14 >= 15) {
    lines.push({
      label: "Stretched",
      detail: `Upper quintile of range after a sharp run. Fresh bullish theses start uphill: the bar for "surprise" is high.`,
    });
  } else if (rangePos <= 20 && run14 <= -10) {
    lines.push({
      label: "Compressed",
      detail: `Lower quintile after a drawdown. Bearish theses start uphill; bullish surprises have room.`,
    });
  }
  return lines;
}

/** Full market test for one ticker: quote + positioning gauge lines. */
export async function marketTest(ticker: string): Promise<{ lines: string[] }> {
  const [quote] = await getQuotes([ticker]);
  const lines: string[] = [];
  if (!quote?.symbol || quote.price === null) {
    lines.push(`${ticker}: no Binance listing`);
    return { lines };
  }
  const pct24 = quote.change24hPct ?? 0;
  lines.push(
    `${ticker} (${quote.symbol}): $${quote.price.toFixed(2)} (${pct24 >= 0 ? "+" : ""}${pct24.toFixed(2)}% 24h)`,
  );
  const candles = await getKlines(quote.symbol);
  for (const g of positioningGauge(quote.symbol, candles)) {
    lines.push(`${g.label}: ${g.detail}`);
  }
  return { lines };
}
