import { db, ensureSchema, nowIso } from "@/lib/db";
import { claims, inquiries } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { chatJson, computeRouterConfig } from "@/lib/0g/compute-router";
import { guidedSystem } from "./soul";
import { buildMarketSnapshot, companyToTicker, extractTicker } from "@/lib/binance/market";
import { marketTest } from "@/lib/binance/market-test";
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
  /** underpriced | priced | unclear — the market-test conclusion. */
  verdict?: string;
  sources: SynthesisSource[];
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
- CONFIDENCE HONESTY: confidence ranks assessments against each other; it is not a prediction probability. Never manufacture precision. A 62 with a complete chain beats an 88 with a gap, and the body must make that visible.
- HONESTY: if evidence is thin, off-target, or stale, say so plainly in the preamble — "Honestly, what came back may not be exactly what you hoped — here's why — but these are the strongest threads we found." Never pad.
- SOURCES: every assessment carries 1-4 source links from its evidence. label = site hostname or short desc, url = exact evidence URL.
- VOICE: contractions are fine. Short paragraphs. Direct and warm. No hashtags, no emoji, no corporate robot talk. If you wouldn't say it to a person, don't write it.

Respond with JSON only, exactly:
{"preamble":"<1-3 sentences setting expectations honestly, spoken style>",
 "recommendations":[{"company":"<clean company name>","title":"<one-line hook, human>","body":"<3-5 sentences: found → suggests → take, human spoken>","confidence":<0-100>,"verdict":"<underpriced | priced | unclear>","sources":[{"label":"<site>","url":"<url>"}]}]}
Order recommendations strongest first. 1-6 recommendations. If nothing is assessable, return empty recommendations and explain honestly in the preamble.`;

function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(group|plc|ltd|limited|inc|corp|company|holdings)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Deterministic fallback: merge same-named entries, attach real source URLs, but speak like a person. */
function fallbackSynthesis(
  question: string,
  entries: (ReadoutEntry & { sources: SynthesisSource[] })[],
): Synthesis {
  const merged = new Map<
    string,
    { name: string; confidence: number; sources: SynthesisSource[]; claim: string }
  >();
  for (const e of entries) {
    const key = normalizeCompany(e.company) || e.company.toLowerCase();
    const existing = merged.get(key);
    if (existing) {
      existing.confidence = Math.max(existing.confidence, e.confidence);
      for (const s of e.sources) {
        if (!existing.sources.some((x) => x.url === s.url)) existing.sources.push(s);
      }
    } else {
      merged.set(key, {
        name: e.company,
        confidence: e.confidence,
        sources: [...e.sources],
        claim: e.topClaim,
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
  const recs = Array.from(merged.values())
    .sort((a, b) => b.confidence - a.confidence)
    .map((m) => {
      const sourceSite = m.sources[0]?.label ?? "a source";
      // Avoid "We found that We found..." — m.claim or topClaim often already starts with "We found"
      const rawFound = m.claim.trim();
      const found = /^We found/i.test(rawFound) ? rawFound : `We found ${rawFound}`;
      // Strip double prefix if present
      const foundClean = found.replace(/^We found that We found/i, "We found").replace(/^We found that /i, "We found ");
      const titleSnippet = rawFound.replace(/^We found\s+/i, "").slice(0, 86);
      // Vary suggests/take so not every card says "build-out phase"
      const suggestsPoolHigh = [
        `That kind of development moves exposed names. Worth checking whether the move is already in the price.`,
        `Capital moves like this travel down the exposure chain toward ${watchPhrase}. The question now is timing to impact.`,
        `This creates exposure for suppliers and infrastructure names around it. Watch who benefits next.`,
      ];
      const suggestsPoolLow = [
        `Worth tracing the impact path into ${watchPhrase} before treating this as edge. The link needs confirming.`,
        `Similar developments have moved exposed tickers within weeks. Check freshness against the current price.`,
        `Interesting thread, thin chain. Worth waiting for a second source before acting on it.`,
      ];
      const takePoolHigh = [
        `We'd watch for confirmation in the next data point: supplier commentary, a filing, or a price reaction.`,
        `We'd look for the move in related names to confirm the chain is live.`,
      ];
      const takePoolLow = [
        `We'd wait for corroboration before treating this as a thesis.`,
        `Low lift to verify: a second independent source would change this assessment.`,
      ];
      // Deterministic pick by name hash so same company varies but not random per render
      const hash = [...m.name].reduce((a, c) => a + c.charCodeAt(0), 0);
      const suggests = (m.confidence >= 75 ? suggestsPoolHigh[hash % suggestsPoolHigh.length] : suggestsPoolLow[hash % suggestsPoolLow.length])!;
      const take = (m.confidence >= 75 ? takePoolHigh[hash % takePoolHigh.length] : takePoolLow[hash % takePoolLow.length])!;
      const body = foundClean.startsWith("We found")
        ? `${foundClean} — reported via ${sourceSite}. ${suggests} ${take}`
        : `We found ${foundClean} — reported via ${sourceSite}. ${suggests} ${take}`;
      const verdict = m.confidence >= 75 ? "underpriced" : m.confidence >= 55 ? "unclear" : "unclear";
      return {
        company: m.name,
        title: titleSnippet.slice(0, 90),
        body,
        confidence: m.confidence,
        verdict,
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
          .map((r) => ({
            company: r.company,
            title: typeof r.title === "string" ? r.title : r.company,
            body: r.body,
            confidence: Number.isFinite(r.confidence) ? Math.round(r.confidence) : 60,
            ...(typeof (r as { verdict?: unknown }).verdict === "string"
              ? { verdict: (r as { verdict: string }).verdict }
              : {}),
            sources: Array.isArray(r.sources)
              ? r.sources.filter((s) => s && typeof s.url === "string").slice(0, 4)
              : [],
          }))
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
  let depth = 0;
  let start = -1;
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
      if (depth === 0) start = i;
      depth++;
      continue;
    }
    if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          const obj = JSON.parse(content.slice(start, i + 1)) as {
            company?: unknown;
            body?: unknown;
          };
          if (typeof obj.company === "string" && typeof obj.body === "string") {
            out.push(obj as Synthesis["recommendations"][number]);
          }
        } catch {
          // incomplete object — skip it, keep the complete ones
        }
        start = -1;
      }
      if (depth < 0) depth = 0;
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
  // Live market check (Binance): snapshot prices for every assessed company.
  // Thesis first, price last. Advisory: never blocks synthesis.
  let marketBlock = "MARKET SNAPSHOT: unavailable (no Binance listing matched).";
  let marketByCompany = new Map<string, { symbol: string; price: number; change24hPct: number }>();
  let marketPersist: { at: string; lines: string[]; byCompany: Record<string, { symbol: string; price: number; change24hPct: number }> } | null = null;
  try {
    const snapshot = await buildMarketSnapshot(
      withSources.map((e) => e.company),
      inquiry.question,
    );
    marketByCompany = snapshot.byCompany;
    marketPersist = {
      at: nowIso(),
      lines: snapshot.lines,
      byCompany: Object.fromEntries(snapshot.byCompany),
    };
    if (snapshot.lines.length > 0) {
      marketBlock = `MARKET SNAPSHOT (live, Binance, 24h):\n${snapshot.lines.join("\n")}\nUse this as the market test: compare event freshness against the observed move. A fresh strong chain with a small move suggests underpriced; a large move already reflecting the event suggests priced.`;
    }
    // Positioning gauge: where price already IS, for up to three listed names.
    // Question ticker first. Measurements only; the verdict stays with the thesis.
    try {
      const tickers: string[] = [];
      const qTick = extractTicker(inquiry.question.replace(/^watch\s+/i, ""));
      if (qTick) tickers.push(qTick);
      for (const name of withSources.map((e) => e.company)) {
        const mapped = companyToTicker(name);
        if (mapped && !tickers.includes(mapped)) tickers.push(mapped);
      }
      for (const t of tickers.slice(0, 3)) {
        const test = await marketTest(t);
        if (test.lines.length > 1) {
          marketBlock += `\nPOSITIONING (${t}):\n${test.lines.slice(1).join("\n")}`;
        }
      }
    } catch {
      // gauge is advisory
    }
  } catch {
    // fall through with unavailable snapshot
  }
  if (!router.live) {
    synthesis = fallbackSynthesis(inquiry.question, withSources);
  } else {
    synthesis = fallbackSynthesis(inquiry.question, withSources);
    let lastError = "router not attempted";
    let wroteThesis = false;
    // Keep the prompt compact. Large payloads push the model into truncation,
    // which was the main source of fallback screens. Top companies only,
    // short claims, few sources.
    const compact = withSources.slice(0, 6).map((e, i) => ({
      i,
      company: e.company.slice(0, 80),
      confidence: e.confidence,
      claims: e.claims,
      independent_sources: e.independentSources,
      top_claim: e.topClaim.slice(0, 600),
      market: marketByCompany.get(e.company) ?? null,
      sources: e.sources.slice(0, 3).map((s) => ({
        label: s.label.slice(0, 40),
        url: s.url.slice(0, 200),
      })),
    }));
    const marketShort = marketBlock.slice(0, 1500);
    for (let attempt = 0; attempt < 3 && !wroteThesis; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 4000));
      try {
        const soul = await guidedSystem(SYSTEM);
        const result = await chatJson({
          system: soul,
          user: `WATCH QUESTION:\n${inquiry.question}\n\nCLUSTERED EVIDENCE (each entry is one company with its strongest claim and sources):\n${compact
            .map((p) => JSON.stringify(p))
            .join("\n")}\n\n${marketShort}\n\nWrite the readout now. Facts first, then what each finding suggests for the watched ticker through its exposure path.`,
          maxTokens: 2200,
          temperature: 0.3,
          timeoutMs: 60_000,
        });
        synthesis = coerceSynthesis(result.content, withSources);
        wroteThesis = true;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message.slice(0, 200) : "synthesis call failed";
        // chatJson validates JSON before returning. On truncation or fenced
        // prose it throws with rawContent attached. Salvage complete
        // assessments instead of discarding the whole thesis.
        const raw = (error as { rawContent?: unknown }).rawContent;
        if (typeof raw === "string" && raw.length > 50) {
          try {
            const salvaged = coerceSynthesis(raw, withSources);
            if (salvaged.recommendations.length > 0) {
              synthesis = salvaged;
              wroteThesis = true;
              break;
            }
          } catch {
            // keep retrying
          }
        }
      }
    }
    if (!wroteThesis) {
      console.error("synthesis fell back to deterministic:", lastError);
    }
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
