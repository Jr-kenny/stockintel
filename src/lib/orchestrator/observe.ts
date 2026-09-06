import { extractTicker } from "@/lib/binance/market";
import type { RecallResult } from "@/lib/memory";

export type ObservedHeadline = {
  title: string;
  source: string;
  observed: string;
};

export type Observation = {
  ticker: string | null;
  priceLine: string;
  headlines: ObservedHeadline[];
  memoryNote: string;
  text: string;
};

function topicWords(question: string): string[] {
  const stop = new Set(
    "a an and are as at be been by for find from has have how i in into is it its me my of on or our sell selling show that the their them they this to us want was we what which who will with you your watch watching stock price".split(
      " ",
    ),
  );
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stop.has(w) && !/^\d+$/.test(w))
    .slice(0, 3);
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T | null> {
  const timer = new Promise<null>((resolve) => {
    setTimeout(() => {
      console.warn(`[observe] ${label} timed out after ${ms}ms`);
      resolve(null);
    }, ms);
  });
  return Promise.race([p, timer]);
}

function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  if (!m?.[1]) return null;
  return m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
}

function toDate(raw: string): string | null {
  const d = raw ? new Date(raw) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

async function fetchHeadlines(query: string): Promise<ObservedHeadline[]> {
  const url =
    `https://news.google.com/rss/search?q=${encodeURIComponent(query)}` +
    "&hl=en-US&gl=US&ceid=US:en";
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; StockIntel-Observe/1.0)" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`google news ${res.status}`);
  const xml = await res.text();
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  const out: ObservedHeadline[] = [];
  for (const item of items.slice(0, 8)) {
    const title = tag(item, "title");
    if (!title) continue;
    const link = tag(item, "link") ?? "";
    let source = "news";
    try {
      const host = new URL(link).hostname.replace(/^www\./, "");
      if (host) source = host;
    } catch {
      const src = item.match(/<source[^>]*>([^<]+)<\/source>/)?.[1]?.trim();
      if (src) source = src;
    }
    const pubDate = tag(item, "pubDate") ?? "";
    out.push({
      title: title.replace(/\s+-\s+[^-]+$/, "").slice(0, 180),
      source: source.slice(0, 60),
      observed: toDate(pubDate) ?? new Date().toISOString().slice(0, 10),
    });
  }
  return out;
}

/**
 * Observation pass. Runs before hypothesis so the model reasons from what is
 * happening now, not from recollection. Three inputs, all best effort:
 * live price for the watched ticker, fresh headlines, prior run state.
 * Failure in any leg leaves that leg empty, never blocks dispatch.
 */
export async function observeQuestion(
  question: string,
  recall: RecallResult,
): Promise<Observation> {
  const cleaned = question.replace(/^watch\s+/i, "").trim();
  const ticker = extractTicker(cleaned) || null;
  const topics = topicWords(question);
  const query = ticker || topics.join(" ");

  let priceLine = "Price check skipped: no ticker resolved from the question.";
  let gaugeLines: string[] = [];
  if (ticker) {
    try {
      const { marketTest } = await import("@/lib/binance/market-test");
      const test = await withTimeout(marketTest(ticker), 12_000, "price");
      if (test && test.lines.length > 0) {
        priceLine = test.lines[0]!;
        gaugeLines = test.lines.slice(1, 5);
      } else {
        priceLine = `${ticker}: no Binance listing, price check unavailable.`;
      }
    } catch {
      priceLine = `${ticker}: price check failed, treat tape as unknown.`;
    }
  }

  let headlines: ObservedHeadline[] = [];
  if (query) {
    try {
      const fetched = await withTimeout(fetchHeadlines(query), 12_000, "headlines");
      if (fetched) headlines = fetched;
    } catch (err) {
      console.warn(
        "[observe] headlines failed:",
        err instanceof Error ? err.message.slice(0, 120) : err,
      );
    }
  }

  const memParts: string[] = [];
  if (recall.similarPast.length > 0) {
    const past = recall.similarPast
      .slice(0, 2)
      .map(
        (p) =>
          `"${p.question.slice(0, 80)}" (${p.companies.slice(0, 3).join(", ") || "no companies"})`,
      )
      .join("; ");
    memParts.push(`Related past runs: ${past}.`);
  }
  if (recall.knownClaims.length > 0) {
    const known = recall.knownClaims
      .slice(0, 3)
      .map((c) => `${c.company}: ${c.claim.slice(0, 90)}`)
      .join("; ");
    memParts.push(`Open claims from memory: ${known}.`);
  }
  const memoryNote =
    memParts.length > 0 ? memParts.join(" ") : "No related past runs or open claims.";

  const lines: string[] = [];
  lines.push(`WATCHED: ${ticker ?? topics.join(" ") ?? question.slice(0, 60)}`);
  lines.push(`TAPE: ${priceLine}`);
  for (const g of gaugeLines) lines.push(`TAPE: ${g}`);
  if (headlines.length > 0) {
    lines.push(`FRESH HEADLINES (${headlines.length}):`);
    for (const h of headlines) {
      lines.push(`- ${h.title} [${h.source}, ${h.observed}]`);
    }
  } else {
    lines.push("FRESH HEADLINES: none captured, do not assume quiet, just no sample.");
  }
  lines.push(`MEMORY: ${memoryNote}`);

  return { ticker, priceLine, headlines, memoryNote, text: lines.join("\n") };
}
