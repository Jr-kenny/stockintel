import { db, ensureSchema, nowIso } from "@/lib/db";
import { claims, inquiries } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { chatJson, computeRouterConfig } from "@/lib/0g/compute-router";
import { chatJsonOpenRouter, openRouterConfig } from "@/lib/llm/openrouter";
import { chatJsonZen, zenConfig } from "@/lib/llm/zen";
import { guidedSystem } from "./soul";
import { buildMarketSnapshot, companyToTicker, extractTicker } from "@/lib/binance/market";
import { getKlines, marketTest, positioningGauge } from "@/lib/binance/market-test";
import { getQuotes } from "@/lib/binance/market";
import { sourceClusterKey } from "./grade";

/**
 * The synthesis pass — where the orchestrator thinks out loud to the watcher.
 *
 * Grading weights evidence; synthesis decides what it MEANS for this watch:
 * - several news items about one company become ONE company;
 * - a headline is not a company name ("Stock of the Day: Buy Ola Electric"
 *   is about Ola Electric);
 * - not every signal is an assessment — the preamble says honestly when
 *   what came back is thin;
 * - every assessment carries the source links the client can open.
 *
 * Voice and judgment rules live in soul.md at the repo root.
 * Falls back to deterministic merged readout if the Router is unavailable.
 */

export type SynthesisSource = {
  label: string;
  url: string;
};

export type SynthesisRecommendation = {
  company: string;
  title: string;
  body: string;
  confidence: number;
  /** underpriced | priced | unclear — the market-test conclusion. Always present. */
  verdict: string;
  /** One-line Agent OS market call, always present. Priced in yet or not, with numbers. */
  marketCall: string;
  /** Expected window for the thesis to play out, always present. */
  timeframe: string;
  /** Live Binance lines behind the call, for transparency. */
  marketLines?: string[];
  sources: SynthesisSource[];
};

export type MarketFacts = {
  symbol: string | null;
  price: number | null;
  change24hPct: number | null;
  rangePos: number | null;
  run14: number | null;
  wobble: number | null;
  stretched: boolean;
  compressed: boolean;
  lines: string[];
};

export type Synthesis = {
  preamble: string;
  recommendations: SynthesisRecommendation[];
};

type ReadoutEntry = {
  company: string;
  confidence: number;
  claims: number;
  independentSources: number;
  topClaim: string;
  contributingAgents: string[];
};


const SYSTEM = `You are the Intelligence Director of StockIntel. You brief a busy watcher — not an analyst, not a committee — in plain, warm, spoken language. Think: how you'd explain it to them over coffee, with the receipts on the table.

Investigators returned clustered evidence for the watcher's ticker. You turn that into a readout the watcher will actually act on.

HARD RULES:
- MERGE: multiple entries about the same real-world company are ONE assessment with one clean name. Work out the real company from headlines ("Stock of The Day: Buy Ola Electric" is Ola Electric, not "Stock"). Never output two assessments for one company.
- FACT vs INFERENCE: every assessment must separate what we FOUND (source said X on date, with link) from what it SUGGESTS (because X, ticker Y is exposed through path Z). Never present a guess as a fact. Use phrases like "We found...", "The filing says...", "This suggests...", "So the exposure here is..."
- HUMAN REASONING: each body is 3-5 sentences that walk the watcher through your thinking out loud:
  1) What we found — the concrete event with how recent it is
  2) Why it matters for THIS ticker — the impact path from event to exposure (never a purchase recommendation)
  3) Your take — is this high confidence or needs a check, what to watch next, and what would invalidate it
  Write it like you're speaking: "Here's why this one stands out..." / "Honestly, this is thinner than the others because...". No bullet lists inside the body, no jargon, no hype, no buy/sell language.
- VERDICT: every assessment ends in one of three conclusions, set the verdict field accordingly:
  "underpriced" (the chain holds and the market has not fully reacted),
  "priced" (interesting event, already incorporated, no actionable edge — say so plainly, this is a valid outcome),
  "unclear" (the chain is incomplete; the body says what is missing).
- MARKET CALL: every assessment MUST carry a marketCall, one plain sentence with numbers from MARKET SNAPSHOT and POSITIONING. Examples: "NVDA at $182.40 (+1.2% 24h), mid-range after a +4% 14-session run: the move is not yet in the price." or "Already up 18% into the upper quintile: priced, no edge." Never leave it empty. This is the product.
- TIMEFRAME: every assessment MUST carry a timeframe like "days to weeks", "1 to 4 weeks", or "unclear, needs confirmation". Base it on evidence freshness and market wobble. Never leave it empty.
- CONFIDENCE HONESTY: confidence ranks assessments against each other; it is not a prediction probability. Never manufacture precision. A 62 with a complete chain beats an 88 with a gap, and the body must make that visible.
- HONESTY: if evidence is thin, off-target, or stale, say so plainly in the preamble — "Honestly, what came back may not be exactly what you hoped — here's why — but these are the strongest threads we found." Never pad.
- SOURCES: every assessment carries 1-4 source links from its evidence. label = site hostname or short desc, url = exact evidence URL.
- VOICE: contractions are fine. Short paragraphs. Direct and warm. No hashtags, no emoji, no corporate robot talk. If you wouldn't say it to a person, don't write it.

Respond with JSON only, exactly:
{"preamble":"<1-3 sentences setting expectations honestly, spoken style>",
 "recommendations":[{"company":"<clean company name>","title":"<one-line hook, human>","body":"<3-5 sentences: found → suggests → take, human spoken, end with the market call in plain words>","confidence":<0-100>,"verdict":"<underpriced | priced | unclear>","marketCall":"<one sentence with price, 24h move, range position and priced or not>","timeframe":"<days to weeks | 1 to 4 weeks | unclear, needs confirmation>","sources":[{"label":"<site>","url":"<url>"}]}]}
Order recommendations strongest first. 1-6 recommendations. If nothing is assessable, return empty recommendations and explain honestly in the preamble.`;

function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(group|plc|ltd|limited|inc|corp|company|holdings)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Deterministic market verdict from real gauge numbers. No guessing. */
export function marketVerdict(facts: MarketFacts, confidence: number, independentSources = 0): {
  verdict: string;
  marketCall: string;
  timeframe: string;
} {
  if (!facts.symbol || facts.price === null) {
    return {
      verdict: "unclear",
      marketCall: "No Binance listing matched, so no priced-in call is possible yet.",
      timeframe: "unclear, needs confirmation",
    };
  }
  const pct24 = facts.change24hPct ?? 0;
  const price = `$${facts.price.toFixed(2)} (${pct24 >= 0 ? "+" : ""}${pct24.toFixed(2)}% 24h)`;
  const run = facts.run14 ?? 0;
  const range = facts.rangePos ?? 50;
  if (facts.stretched) {
    return {
      verdict: "priced",
      marketCall: `${facts.symbol} at ${price}, upper quintile after a sharp run. The move looks priced, no edge right now.`,
      timeframe: "unclear, needs confirmation",
    };
  }
  if (confidence >= 70 && (range < 80 || (Math.abs(run) < 5 && Math.abs(pct24) < 2))) {
    const rangeTxt = facts.rangePos !== null ? `, ${facts.rangePos.toFixed(0)}% of range` : "";
    return {
      verdict: "underpriced",
      marketCall: `${facts.symbol} at ${price}${rangeTxt}. The event is fresh and the move is not yet in the price.`,
      timeframe: Math.abs(run) > 10 ? "days to weeks" : "1 to 4 weeks",
    };
  }
  if (range >= 80) {
    return {
      verdict: "unclear",
      marketCall: `${facts.symbol} at ${price}, near the top of its range. The chain is real but the bar for surprise is high after this run.`,
      timeframe: "unclear, needs confirmation",
    };
  }
  if (facts.compressed && confidence < 60) {
    return {
      verdict: "unclear",
      marketCall: `${facts.symbol} at ${price}, lower quintile after a drawdown. Weak chain, so no call yet.`,
      timeframe: "unclear, needs confirmation",
    };
  }
  return {
    verdict: "unclear",
    marketCall:
      independentSources >= 2
        ? `${facts.symbol} at ${price}. Evidence is real but the price already reflects part of it, so no clean edge yet.`
        : `${facts.symbol} at ${price}. The chain needs a second source before a priced-in call is honest.`,
    timeframe: "unclear, needs confirmation",
  };
}

/** Headlines never become assessments, even from old rows. */
function isHeadlineName(name: string): boolean {
  const HEADLINE_VERBS = new Set(
    "analyzing launches launched launch doubles doubled doubles raises raised raise cuts cut beats beat misses missed warns warned unveils unveiled posts posted reports reported says said plans planned wins won faces faced".split(
      " ",
    ),
  );
  const GENERIC_BIZ = new Set(
    "ai tech big great new global top capex spending server servers spend spends market markets stock stocks data center cloud chip chips silicon semiconductor semiconductors industry sectors sector business businesses group power energy article news update report foregoing".split(
      " ",
    ),
  );
  const clean = name.trim();
  if (/sponsored/i.test(clean)) return true;
  const words = clean.split(/\s+/);
  if (words.length > 5) return true;
  if (
    /^(from|if|to|as|at|on|in|with|after|before|during|while|when|where|how|why|what|and|but|or|for|by|of|the|a|an)\b/i.test(
      clean,
    )
  )
    return true;
  const tailPossessive = /\u2019s$|'s$/i.test(words[words.length - 1] ?? "");
      if (words.length > 1 && tailPossessive) return true;
      const tokens = words.map((t) => t.toLowerCase().replace(/[^a-z]/g, ""));
  if (tokens.some((t) => HEADLINE_VERBS.has(t))) return true;
  if (tokens.length > 0 && tokens.every((t) => GENERIC_BIZ.has(t))) return true;
  return false;
}
function fallbackSynthesis(
  question: string,
  entries: (ReadoutEntry & { sources: SynthesisSource[] })[],
  marketByTicker: Map<string, MarketFacts> = new Map(),
): Synthesis {
  const merged = new Map<
    string,
    { name: string; confidence: number; sources: SynthesisSource[]; claim: string; independentSources: number }
  >();
  for (const e of entries) {
    if (isHeadlineName(e.company)) continue;
    const key = normalizeCompany(e.company) || e.company.toLowerCase();
    const existing = merged.get(key);
    if (existing) {
      existing.confidence = Math.max(existing.confidence, e.confidence);
      existing.independentSources = Math.max(existing.independentSources, e.independentSources ?? 0);
      for (const s of e.sources) {
        if (!existing.sources.some((x) => x.url === s.url)) existing.sources.push(s);
      }
    } else {
      merged.set(key, {
        name: e.company,
        confidence: e.confidence,
        sources: [...e.sources],
        claim: e.topClaim,
        independentSources: e.independentSources ?? 0,
      });
    }
  }
  // Short watch phrase for fallback bodies. Ticker first, else a question clip.
  const watchPhrase = (() => {
    const tick = question.match(/watch(?:ing)?\s+([A-Za-z]{1,20})\b/i);
    if (tick?.[1]) return tick[1];
    const first = question.split(/[.?!]/)[0]?.trim() ?? "";
    if (first.length > 12 && first.length < 70) return first.slice(0, 64);
    return "the watched ticker";
  })();
  const watchTicker = (() => {
    const tick = question.match(/watch(?:ing)?\s+([A-Za-z]{1,6})\b/i);
    return (tick?.[1] ?? watchPhrase).toUpperCase().slice(0, 6);
  })();
  // Deterministic exposure analysis: trace the path ourselves instead of
  // asking the watcher to. Link flavor follows the claim type, the fallback
  // argument follows scale and installed base, and every path names what
  // would break it.
  function exposurePath(
    claim: string,
    ticker: string,
  ): { link: string; invalidate: string } {
    const c = claim.toLowerCase();
    if (/capex|guidance|budget|spending|invest|funding|raise|\bbillion\b|\bmillion\b/.test(c))
      return {
        link: `Money at this scale turns into purchase orders, and purchase orders in this segment flow toward ${ticker} hardware.`,
        invalidate: `This breaks if the spend lands on in-house silicon or a named competitor instead.`,
      };
    if (/contract|deal|award|partnership|supplier|order|win|wins|won/.test(c))
      return {
        link: `Contracts decide who gets paid first. The read is whether ${ticker} or its partners sit anywhere in this order chain.`,
        invalidate: `This breaks if the order book bypasses ${ticker} entirely.`,
      };
    if (/build|expand|expansion|construction|plant|fab|data center|datacenter|facility|capacity/.test(c))
      return {
        link: `Buildouts at this scale need compute to fill them, and buyers fall back to ${ticker} when capacity has to ship on time.`,
        invalidate: `This breaks if the build stalls or fills with rival silicon.`,
      };
    if (/filing|regulator|approval|rule|tariff|sanction|probe|lawsuit|ban|restrict/.test(c))
      return {
        link: `Filings and rulings set what buyers are allowed to plan around, and the read-through into ${ticker} is demand visibility, up or down.`,
        invalidate: `This breaks if the final text lands softer than the headline.`,
      };
    return {
      link: `Events like this travel through customers and suppliers before they reach ${ticker}, so the move tends to show up there first.`,
      invalidate: `This breaks if no credible link into ${ticker} surfaces.`,
    };
  }
  const recs = Array.from(merged.values())
    .sort((a, b) => b.confidence - a.confidence)
    .map((m, idx) => {
      const sourceSite = m.sources[0]?.label ?? "a source";
      const rawFound = m.claim.trim();
      const found = /^We found/i.test(rawFound) ? rawFound : `We found ${rawFound}`;
      const foundClean = found.replace(/^We found that We found/i, "We found").replace(/^We found that /i, "We found ");
      const titleSnippet = rawFound.replace(/^We found\s+/i, "").slice(0, 86);
      const ticker = companyToTicker(m.name) ?? extractTicker(m.name);
      const facts =
        marketByTicker.get(ticker) ??
        marketByTicker.get(m.name) ?? {
          symbol: null,
          price: null,
          change24hPct: null,
          rangePos: null,
          run14: null,
          wobble: null,
          stretched: false,
          compressed: false,
          lines: [],
        };
      const call = marketVerdict(facts, m.confidence, m.independentSources);
      const path = exposurePath(rawFound, watchTicker);
      const scale =
        idx % 2 === 0
          ? `Few suppliers can serve at this scale, so demand consolidates on the incumbent stack, and most of these buyers already run ${watchTicker}.`
          : `At this scale buyers reorder from whoever can ship, and that short list still starts with ${watchTicker}.`;
      const analysis =
        call.verdict === "priced"
          ? `${path.link} The chain is real, but the market moved first, so chasing it now means paying for news.`
          : call.verdict === "underpriced"
            ? `${path.link} ${scale}`
            : `${path.link} Before treating this as edge, confirm the one thing that would break it. ${path.invalidate}`;
      const body = `${foundClean} — reported via ${sourceSite}. ${analysis} Market check: ${call.marketCall} Timeframe: ${call.timeframe}.`;
      return {
        company: m.name,
        title: titleSnippet.slice(0, 90),
        body,
        confidence: m.confidence,
        verdict: call.verdict,
        marketCall: call.marketCall,
        timeframe: call.timeframe,
        marketLines: facts.lines.slice(0, 5),
        sources: m.sources.slice(0, 4),
      };
    });
  const preamble =
    recs.length === 0
      ? `We ran your watch across every surface but nothing came back strong enough to assess this time. The signals were either too thin or didn't connect clearly to the ticker.`
      : recs.length < 3
        ? `Honestly, what came back was thinner than we'd like, but these are the strongest threads we found. Each one names the event, the exposure path into ${watchPhrase}, and what would change our mind.`
        : `Here's why these stand out for ${watchPhrase}. Each assessment walks from the event through the exposure path to what it suggests, with the source behind every link.`;
  return {
    preamble,
    recommendations: recs,
  };
}

/** Runs after grading: writes the thought-through readout onto the inquiry. */
/** Coerce model output into a Synthesis, re-attaching dropped sources. Throws on unparseable content. */
function coerceSynthesis(
  content: string,
  withSources: (ReadoutEntry & { sources: SynthesisSource[] })[],
  marketByTicker: Map<string, MarketFacts> = new Map(),
): Synthesis {
  const stripped = content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  let parsed: Synthesis;
  try {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("no json object");
    parsed = JSON.parse(stripped.slice(start, end + 1)) as Synthesis;
  } catch {
    // Truncated output: salvage complete recommendation objects instead of
    // discarding the entire thesis.
    const salvaged = salvageRecommendations(content);
    if (salvaged.length === 0) throw new Error("synthesis output unparseable");
    parsed = { preamble: salvagePreamble(content), recommendations: salvaged };
  }
  const synthesis: Synthesis = {
    preamble: typeof parsed.preamble === "string" ? parsed.preamble : "",
    recommendations: Array.isArray(parsed.recommendations)
      ? parsed.recommendations
          .filter((r) => r && typeof r.company === "string" && typeof r.body === "string")
          .map((r) => {
            const company = r.company;
            const ticker = companyToTicker(company) ?? extractTicker(company);
            const facts = marketByTicker.get(ticker) ?? marketByTicker.get(company);
            const match = withSources.find(
              (e) => normalizeCompany(e.company) === normalizeCompany(company),
            );
            const entryConf = match?.confidence;
            const rawConf = Number.isFinite(r.confidence) ? Math.round(r.confidence) : NaN;
            const confidence =
              Number.isFinite(rawConf) && (rawConf as number) >= 10 && (rawConf as number) <= 100
                ? (rawConf as number)
                : typeof entryConf === "number"
                  ? Math.round(entryConf)
                  : 60;
            const fallbackCall = facts
              ? marketVerdict(facts, confidence, match?.independentSources ?? 0)
              : { verdict: "unclear", marketCall: "No market snapshot available.", timeframe: "unclear, needs confirmation" };
            const verdict =
              typeof (r as { verdict?: unknown }).verdict === "string" &&
              ["underpriced", "priced", "unclear"].includes((r as { verdict: string }).verdict)
                ? (r as { verdict: string }).verdict
                : fallbackCall.verdict;
            const rawCall =
              typeof (r as { marketCall?: unknown }).marketCall === "string"
                ? (r as { marketCall: string }).marketCall
                : "";
            // Never ship buy/sell orders as the market call.
            const marketCall =
              rawCall.length > 10 && !/^(buy|sell|long|short)\b/i.test(rawCall.trim())
                ? rawCall
                : fallbackCall.marketCall;
            const timeframe =
              typeof (r as { timeframe?: unknown }).timeframe === "string" &&
              ((r as { timeframe: string }).timeframe?.length ?? 0) > 2
                ? (r as { timeframe: string }).timeframe
                : fallbackCall.timeframe;
            return {
              company,
              title: typeof r.title === "string" ? r.title : company,
              body: r.body,
              confidence,
              verdict,
              marketCall,
              timeframe,
              ...(facts ? { marketLines: facts.lines.slice(0, 5) } : {}),
              sources: Array.isArray(r.sources)
                ? r.sources.filter((s) => s && typeof s.url === "string").slice(0, 4)
                : [],
            };
          })
      : [],
  };
  // Never lose the receipts: if the model dropped sources, re-attach them.
  for (const rec of synthesis.recommendations) {
    if (rec.sources.length === 0) {
      const match = withSources.find(
        (e) => normalizeCompany(e.company) === normalizeCompany(rec.company),
      );
      if (match) rec.sources = match.sources.slice(0, 4);
    }
  }
  return synthesis;
}

/** Pull complete recommendation objects out of truncated model output. */
function salvageRecommendations(content: string): Synthesis["recommendations"] {
  const out: Synthesis["recommendations"] = [];
  // Scan every balanced { } pair at any depth. Recommendations are nested
  // inside the outer object, so top-level-only scanning misses them when
  // output truncates mid-array.
  const stack: number[] = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === "{") {
      stack.push(i);
      continue;
    }
    if (ch === "}") {
      const start = stack.pop();
      if (start === undefined) continue;
      try {
        const obj = JSON.parse(content.slice(start, i + 1)) as {
          company?: unknown;
          body?: unknown;
        };
        if (typeof obj.company === "string" && typeof obj.body === "string") {
          if (!out.some((r) => r.company === obj.company && r.body === obj.body)) {
            out.push(obj as Synthesis["recommendations"][number]);
          }
        }
      } catch {
        // incomplete object — skip it, keep the complete ones
      }
    }
  }
  return out;
}

/** Pull the preamble string out of truncated model output, if complete. */
function salvagePreamble(content: string): string {
  const m = content.match(/"preamble"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!m?.[1]) return "";
  try {
    return JSON.parse(`"${m[1]}"`).slice(0, 500) as string;
  } catch {
    return "";
  }
}

export async function synthesizeInquiry(inquiryId: string): Promise<void> {  await ensureSchema();
  const [inquiry] = await db.select().from(inquiries).where(eq(inquiries.id, inquiryId));
  if (!inquiry?.readoutJson) return;

  const readout = JSON.parse(inquiry.readoutJson) as ReadoutEntry[];
  const claimRows = await db.select().from(claims).where(eq(claims.inquiryId, inquiryId));

  // Attach every real source URL we hold to its readout entry.
  const withSources = readout.map((entry) => {
    const key = normalizeCompany(entry.company);
    const sources: SynthesisSource[] = [];
    for (const row of claimRows) {
      const rowKey = normalizeCompany(row.company);
      if (rowKey !== key) continue;
      let evidence: { item: string; source: string }[] = [];
      try {
        evidence = JSON.parse(row.evidenceJson || "[]");
      } catch {
        continue;
      }
      for (const ev of evidence) {
        if (!ev.source) continue;
        const isUrl = /^https?:\/\//.test(ev.source);
        const url = isUrl ? ev.source : "";
        let label = "source";
        if (isUrl) {
          try {
            label = new URL(ev.source).hostname.replace(/^www\./, "");
          } catch {
            label = ev.source.slice(0, 40);
          }
        } else {
          label = ev.source.slice(0, 60);
        }
        const merged: SynthesisSource = isUrl ? { label, url } : { label, url: ev.source };
        if (
          !sources.some(
            (s) =>
              sourceClusterKey(s.url || s.label) === sourceClusterKey(merged.url || merged.label),
          )
        ) {
          sources.push(merged);
        }
      }
    }
    return { ...entry, sources: sources.slice(0, 6) };
  });

  let synthesis: Synthesis;
  const router = computeRouterConfig();
  const openRouter = openRouterConfig();
  const zen = zenConfig();
  // Live market check (Binance Agent OS data): snapshot plus positioning gauge.
  // This is the product. It runs first and every thesis path below carries it.
  let marketBlock = "MARKET SNAPSHOT: unavailable (no Binance listing matched).";
  const marketByCompany = new Map<string, { symbol: string; price: number; change24hPct: number }>();
  const marketByTicker = new Map<string, MarketFacts>();
  let marketPersist: { at: string; lines: string[]; byCompany: Record<string, { symbol: string; price: number; change24hPct: number }> } | null = null;
  try {
    const snapshot = await buildMarketSnapshot(
      withSources.map((e) => e.company),
      inquiry.question,
    );
    for (const [k, v] of snapshot.byCompany) marketByCompany.set(k, v);
    marketPersist = {
      at: nowIso(),
      lines: snapshot.lines,
      byCompany: Object.fromEntries(snapshot.byCompany),
    };
    if (snapshot.lines.length > 0) {
      marketBlock = `MARKET SNAPSHOT (live, Binance, 24h):\n${snapshot.lines.join("\n")}\nUse this as the market test: compare event freshness against the observed move. A fresh strong chain with a small move suggests underpriced; a large move already reflecting the event suggests priced.`;
    }
    const tickers: string[] = [];
    const qTick = extractTicker(inquiry.question.replace(/^watch\s+/i, ""));
    if (qTick) tickers.push(qTick);
    for (const name of withSources.map((e) => e.company)) {
      const mapped = companyToTicker(name);
      if (mapped && !tickers.includes(mapped)) tickers.push(mapped);
    }
    const quotes = await getQuotes(tickers.slice(0, 6));
    for (const q of quotes) {
      if (!q.symbol || q.price === null) {
        marketByTicker.set(q.ticker, {
          symbol: null,
          price: null,
          change24hPct: null,
          rangePos: null,
          run14: null,
          wobble: null,
          stretched: false,
          compressed: false,
          lines: [`${q.ticker}: no Binance listing`],
        });
        continue;
      }
      let facts: MarketFacts = {
        symbol: q.symbol,
        price: q.price,
        change24hPct: q.change24hPct ?? 0,
        rangePos: null,
        run14: null,
        wobble: null,
        stretched: false,
        compressed: false,
        lines: [`${q.ticker} (${q.symbol}): $${q.price.toFixed(2)} (${(q.change24hPct ?? 0) >= 0 ? "+" : ""}${(q.change24hPct ?? 0).toFixed(2)}% 24h)`],
      };
      try {
        const candles = await getKlines(q.symbol, 120);
        const gauge = positioningGauge(q.symbol, candles);
        for (const g of gauge) facts.lines.push(`${g.label}: ${g.detail}`);
        const rangeLine = gauge.find((g) => g.label === "Range position")?.detail ?? "";
        const runLine = gauge.find((g) => g.label === "Recent run")?.detail ?? "";
        const wobbleLine = gauge.find((g) => g.label === "Daily wobble")?.detail ?? "";
        const rangeM = rangeLine.match(/(\d+)% of its/);
        const runM = runLine.match(/([+-]?\d+\.?\d*)% over/);
        const wobbleM = wobbleLine.match(/±(\d+\.?\d*)%/);
        if (rangeM?.[1]) facts.rangePos = Number(rangeM[1]);
        if (runM?.[1]) facts.run14 = Number(runM[1]);
        if (wobbleM?.[1]) facts.wobble = Number(wobbleM[1]);
        facts.stretched = gauge.some((g) => g.label === "Stretched");
        facts.compressed = gauge.some((g) => g.label === "Compressed");
        marketBlock += `\nPOSITIONING (${q.ticker}):\n${facts.lines.slice(1).join("\n")}`;
      } catch {
        // quote without gauge is still a call
      }
      marketByTicker.set(q.ticker, facts);
    }
  } catch {
    // fall through with unavailable snapshot
  }
  const compact = withSources.slice(0, 4).map((e, i) => {
    const ticker = companyToTicker(e.company) ?? extractTicker(e.company);
    return {
      i,
      company: e.company.slice(0, 60),
      confidence: e.confidence,
      independent_sources: e.independentSources,
      top_claim: e.topClaim.slice(0, 300),
      market: marketByTicker.get(ticker) ?? null,
      sources: e.sources.slice(0, 2).map((s) => ({
        label: s.label.slice(0, 30),
        url: s.url.slice(0, 150),
      })),
    };
  });
  const marketShort = marketBlock.slice(0, 800);
  const userPrompt = `WATCH:\n${inquiry.question.slice(0, 200)}\nEVIDENCE:\n${compact
    .map((p) => JSON.stringify(p))
    .join("\n")}\n${marketShort}\nWrite the readout. Every item MUST have verdict, marketCall with numbers, timeframe.`;
  synthesis = fallbackSynthesis(inquiry.question, withSources, marketByTicker);
  let lastError = "router not attempted";
  let wroteThesis = false;
  // Short contract: long prompts make small/free models return empty.
  // Details (source re-attach, missing-field fill) stay in code.
  // Key names are repeated because models invent their own shape otherwise.
  const leanSystem = `Return ONLY one JSON object with EXACTLY these top-level keys: preamble, recommendations. No other keys. No markdown. No prose.
recommendations is an array of 1-4 objects with EXACTLY these keys: company, title, body, confidence, verdict, marketCall, timeframe, sources.
verdict is one of: underpriced, priced, unclear. marketCall is one sentence with price numbers. timeframe is like "1 to 4 weeks".
Body is 3 short sentences: what we found, the exposure path into the watched ticker, take plus invalidation. Plain warm spoken words, no buy/sell language.
Example: {"preamble":"...","recommendations":[{"company":"NVIDIA","title":"...","body":"...","confidence":82,"verdict":"underpriced","marketCall":"...","timeframe":"1 to 4 weeks","sources":[{"label":"...","url":"..."}]}]}
Doctrine: thesis first, price last. Facts separate from inference.`;
  type ThesisCall = (opts: {
    system: string;
    user: string;
    maxTokens?: number;
    temperature?: number;
    timeoutMs?: number;
  }) => Promise<{ content: string }>;
  // The model sometimes drops a company. Backfill missing threads from the
  // deterministic market-aware builder so no evidence is silently lost.
  function withBackfill(parsed: Synthesis): Synthesis {
    const covered = new Set(parsed.recommendations.map((r) => normalizeCompany(r.company)));
    const missing = withSources.filter((e) => !covered.has(normalizeCompany(e.company)));
    if (missing.length === 0 || parsed.recommendations.length >= 6) return parsed;
    const fill = fallbackSynthesis(inquiry.question, missing, marketByTicker);
    return {
      preamble: parsed.preamble,
      recommendations: [...parsed.recommendations, ...fill.recommendations].slice(0, 6),
    };
  }
  // One attempt: coerce, salvage raw output, else repair by asking the model
  // to reformat its own bad output into the exact schema. Empty
  // recommendations never count as a thesis.
  async function attemptThesis(
    call: ThesisCall,
    label: string,
    temperature: number,
  ): Promise<boolean> {
    try {
      const result = await call({
        system: leanSystem,
        user: userPrompt,
        maxTokens: 1200,
        temperature,
        timeoutMs: 60_000,
      });
      const parsed = coerceSynthesis(result.content, withSources, marketByTicker);
      if (parsed.recommendations.length === 0) throw new Error(`${label} returned zero recommendations`);
      synthesis = withBackfill(parsed);
      return true;
    } catch (error) {
      lastError = error instanceof Error ? error.message.slice(0, 200) : `${label} call failed`;
      const raw = (error as { rawContent?: unknown }).rawContent;
      const candidates = typeof raw === "string" && raw.length > 50 ? [raw] : [];
      for (const text of candidates) {
        try {
          const salvaged = coerceSynthesis(text, withSources, marketByTicker);
          if (salvaged.recommendations.length > 0) {
            synthesis = withBackfill(salvaged);
            return true;
          }
        } catch {
          // try repair below
        }
        // Repair pass: hand the bad output back with the skeleton.
        try {
          const fixed = await call({
            system: `Reformat into EXACTLY {"preamble":string,"recommendations":[{"company":string,"title":string,"body":string,"confidence":number 10-100,"verdict":"underpriced|priced|unclear","marketCall":string,"timeframe":string,"sources":[{"label":string,"url":string}]}]}. JSON only, no prose. Never write buy/sell/long/short orders. marketCall states where price sits with numbers and whether the move is in the price. confidence is 10-100.`,
            user: `Reformat this into the exact schema, keeping all facts and numbers:\n${text.slice(0, 3000)}`,
            maxTokens: 1200,
            temperature: 0.2,
            timeoutMs: 45_000,
          });
          const repaired = coerceSynthesis(fixed.content, withSources, marketByTicker);
          if (repaired.recommendations.length > 0) {
            synthesis = withBackfill(repaired);
            return true;
          }
        } catch {
          // fall through to next provider
        }
      }
      return false;
    }
  }
  // OpenRouter first when keyed (free default), then 0G, then Zen.
  // Temperature escalates per attempt to escape repetitive failure modes.
  if (openRouter.live) {
    for (let attempt = 0; attempt < 2 && !wroteThesis; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 3000));
      wroteThesis = await attemptThesis(chatJsonOpenRouter, "openrouter", attempt === 0 ? 0.3 : 0.6);
    }
    if (!wroteThesis) console.error("OpenRouter thesis failed, trying 0G:", lastError);
  }
  if (!wroteThesis && router.live) {
    for (let attempt = 0; attempt < 2 && !wroteThesis; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 4000));
      wroteThesis = await attemptThesis(chatJson, "0G", attempt === 0 ? 0.3 : 0.6);
    }
    if (!wroteThesis) console.error("0G thesis failed, trying Zen:", lastError);
  }
  if (!wroteThesis && zen.live) {
    for (let attempt = 0; attempt < 2 && !wroteThesis; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 3000));
      wroteThesis = await attemptThesis(chatJsonZen, "zen", attempt === 0 ? 0.3 : 0.6);
    }
    if (!wroteThesis) console.error("Zen thesis failed:", lastError);
  }
  if (!wroteThesis) {
    // Deterministic thesis still carries the full Agent OS market call per
    // company, so the readout never ships without priced-in verdicts.
    synthesis = fallbackSynthesis(inquiry.question, withSources, marketByTicker);
    console.error("thesis from deterministic market-aware builder:", lastError);
  }

  await db
    .update(inquiries)
    .set({
      synthesisJson: JSON.stringify(synthesis),
      ...(marketPersist ? { marketJson: JSON.stringify(marketPersist) } : {}),
      updatedAt: nowIso(),
    })
    .where(eq(inquiries.id, inquiryId));
}
