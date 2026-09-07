/**
 * Write the intelligence report.
 *
 * The old synthesis asked one model for a per-company thesis from four
 * truncated evidence rows, so a run touching six entities shipped six verdicts
 * and six timeframes. This writes ONE report with one assessment, built on the
 * connection pass output: interpreted evidence and named causal chains.
 *
 * Division of labour, deliberately:
 *   connect.ts       finds what the evidence means together
 *   event-reaction   measures whether the tape already moved on those dates
 *   this module      writes the document and states horizons and scenarios
 *
 * Nothing here is sector-specific. A shipping line, a bank and a cement
 * producer go through the same path, because the reasoning lives in the chains
 * and the market leg is arithmetic on candles.
 */

import { jsonProviders } from "@/lib/llm/providers";
import { guidedSystem } from "./soul";
import type { ConnectionResult } from "./connect";
import type { Chain, EvidenceItem, IntelligenceReport } from "./report";
import { reportSchema, traceabilityIssues } from "./report";
import type { PricedInJudgment } from "@/lib/binance/event-reaction";
import { z } from "zod";

/** The model writes judgment; code owns evidence, market lines and priced-in. */
const writableSchema = reportSchema.omit({
  evidence: true,
  implication: true,
  synthesis: true,
});

const partialSchema = writableSchema.extend({
  synthesis: z.object({
    notObvious: z.string(),
    whatChanged: z.string(),
    contradictions: z.array(z.string()).default([]),
  }),
  implication: z.object({
    immediate: z.object({ window: z.string(), assessment: z.string(), evidenceIds: z.array(z.string()).default([]) }),
    weeks: z.object({ window: z.string(), assessment: z.string(), evidenceIds: z.array(z.string()).default([]) }),
    months: z.object({ window: z.string(), assessment: z.string(), evidenceIds: z.array(z.string()).default([]) }),
    year: z.object({ window: z.string(), assessment: z.string(), evidenceIds: z.array(z.string()).default([]) }),
  }),
});

const CONTRACT = `Return ONLY one JSON object. No markdown, no prose outside it.

Keys, EXACTLY these: ticker, period, executive, synthesis, implication, scenarios, bottomLine, confidence.

executive: {whatHappened, whyItMatters, assessment}
  Conclusion FIRST. The reader must learn why the evidence matters without reading it.
  assessment is your current position, stated plainly.

synthesis: {notObvious, whatChanged, contradictions}
  notObvious: what a reader misses taking the events one at a time.
  whatChanged: movement against the prior assessment, or say there is no prior one.
  contradictions: array of strings naming evidence that points the other way. [] if none.

implication: {immediate, weeks, months, year}
  Each is {window, assessment, evidenceIds}.
  windows: "next few days", "1 to 4 weeks", "1 to 3 months", "3 to 12 months".
  Each assessment must say something DIFFERENT. If a horizon is genuinely unknowable, say so
  and why. evidenceIds cite the events behind that horizon.

scenarios: {cases, catalysts, risks, invalidation}
  cases: array of exactly 3, {case:"bull"|"base"|"bear", probability, narrative, requires}.
    probability is a number, the three must sum to about 100. requires is an array of
    conditions that would have to hold.
  catalysts: dated or near-dated events that would move this. array of strings.
  risks: array of strings.
  invalidation: array of strings — what would BREAK your assessment. Never empty.
    This makes the report falsifiable. "Our view holds unless X" not "we believe X".

bottomLine: {remember, monitor, reconsiderIf}
  monitor is the SINGLE most important signal to watch next.

confidence: {band:"high"|"moderate"|"low", reason}
  Calibrate to evidence strength and say why. If the strongest chain rests on one
  aggregator, that is moderate at best, and the reason must name the weakness.

Rules: no buy/sell/long/short language. No price targets you cannot derive from the
market lines given. Cite evidence ids that exist. Speak plainly, contractions are fine,
no em dashes.`;

function parseJsonLoose(raw: string): unknown {
  const text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("no JSON object in response");
    return JSON.parse(text.slice(start, end + 1));
  }
}

function chainLine(c: Chain): string {
  const path = c.hops
    .map((h) => `${h.from} —${h.relation}→ ${h.to} [${h.basis}${h.evidenceIds.length ? ` ${h.evidenceIds.join(",")}` : ""}]`)
    .join("; ");
  return `${c.claim} (${c.direction}/${c.magnitude}): ${path}. ${c.soWhat}`;
}

function buildUser(params: {
  question: string;
  ticker: string;
  connection: ConnectionResult;
  marketLines: string[];
  pricedIn: PricedInJudgment;
  priorSummary: string | null;
}): string {
  const { question, ticker, connection, marketLines, pricedIn, priorSummary } = params;
  const parts: string[] = [
    `WATCHING: ${question.slice(0, 300)}`,
    `TICKER: ${ticker || "unresolved"}`,
    "",
    `EVENTS (${connection.evidence.length}):`,
    ...connection.evidence.map((e) =>
      JSON.stringify({
        id: e.id,
        entity: e.entity,
        observed: e.observed,
        whatHappened: e.whatHappened.slice(0, 260),
        whyItMatters: e.whyItMatters.slice(0, 260),
        confidence: e.confidence,
        confidenceReason: e.confidenceReason,
      }),
    ),
  ];

  if (connection.chains.length > 0) {
    parts.push("", `CHAINS (${connection.chains.length}) — the connections already traced:`);
    parts.push(...connection.chains.map((c) => `- ${chainLine(c)}`));
  } else {
    parts.push(
      "",
      "CHAINS: none were traced. Say so in synthesis rather than inventing connections.",
    );
  }

  if (connection.notObvious) parts.push("", `ALREADY NOTED AS NOT OBVIOUS: ${connection.notObvious}`);
  if (connection.contradictions.length > 0) {
    parts.push("", `CONTRADICTIONS FOUND: ${connection.contradictions.join(" | ")}`);
  }

  parts.push("", "MARKET (measured, do not restate as your own conclusion):");
  parts.push(marketLines.length > 0 ? marketLines.join("\n") : "No market data resolved.");
  parts.push(
    "",
    `PRICED IN (measured by joining event dates to daily candles): ${pricedIn.verdict.toUpperCase()} — ${pricedIn.reason}`,
  );
  if (pricedIn.reactions.length > 0) {
    parts.push(...pricedIn.reactions.slice(0, 6).map((r) => `  ${r.line}`));
  }

  parts.push(
    "",
    priorSummary
      ? `PRIOR ASSESSMENT:\n${priorSummary.slice(0, 700)}`
      : "PRIOR ASSESSMENT: none. This is the first report on this name.",
  );
  parts.push("", "Write the report.");
  return parts.join("\n");
}

/**
 * Deterministic report. Used when every provider fails.
 *
 * It states what is known and refuses to invent the rest: no scenarios it
 * cannot support, no horizon claims beyond the measured market leg. An honest
 * thin report is worth more than a confident hollow one.
 */
function fallbackReport(params: {
  ticker: string;
  period: string;
  connection: ConnectionResult;
  marketLines: string[];
  pricedIn: PricedInJudgment;
}): IntelligenceReport {
  const { ticker, period, connection, marketLines, pricedIn } = params;
  const entities = Array.from(new Set(connection.evidence.map((e) => e.entity))).slice(0, 6);
  const strongest = connection.chains[0];
  const allIds = connection.evidence.map((e) => e.id);

  const horizon = (window: string, assessment: string) => ({
    window,
    assessment,
    evidenceIds: [] as string[],
  });

  return {
    ticker: ticker || "unresolved",
    period,
    executive: {
      whatHappened:
        connection.evidence.length > 0
          ? `${connection.evidence.length} event${connection.evidence.length > 1 ? "s" : ""} surfaced in this window across ${entities.join(", ")}.`
          : "No events surfaced in this window.",
      whyItMatters: strongest
        ? strongest.soWhat
        : "The impact path was not traced on this run, so these events stand as leads rather than findings.",
      assessment:
        "The report writer was unavailable, so this is evidence and measured market context without a written assessment. Treat it as raw material, not intelligence.",
    },
    evidence: connection.evidence,
    synthesis: {
      chains: connection.chains,
      notObvious: connection.notObvious,
      whatChanged: "Not assessed: no comparison against a prior report ran.",
      contradictions: connection.contradictions,
    },
    implication: {
      immediate: horizon("next few days", pricedIn.reason),
      weeks: horizon(
        "1 to 4 weeks",
        "Not assessed. The writer was unavailable and this cannot be derived from price alone.",
      ),
      months: horizon("1 to 3 months", "Not assessed."),
      year: horizon("3 to 12 months", "Not assessed."),
      marketLines,
      pricedIn: pricedIn.verdict,
      pricedInReason: pricedIn.reason,
    },
    scenarios: {
      cases: [],
      catalysts: [],
      risks: [],
      invalidation: [
        "Not assessed. Without a written assessment there is nothing to invalidate, which is itself a reason to treat this report as incomplete.",
      ],
    },
    bottomLine: {
      remember:
        connection.evidence.length > 0
          ? `${connection.evidence.length} event${connection.evidence.length > 1 ? "s" : ""} on record, uninterpreted.`
          : "Nothing on record for this window.",
      monitor: entities[0] ? `Whether the ${entities[0]} thread develops.` : "Nothing specific.",
      reconsiderIf: "A complete run produces an actual assessment.",
    },
    confidence: {
      band: "low",
      reason: "No report writer ran. Evidence is present but uninterpreted.",
    },
  };
}

export type WriteResult = {
  report: IntelligenceReport;
  mode: "llm" | "deterministic";
  issues: string[];
};

export async function writeReport(params: {
  question: string;
  ticker: string;
  period: string;
  connection: ConnectionResult;
  marketLines: string[];
  pricedIn: PricedInJudgment;
  priorSummary?: string | null;
}): Promise<WriteResult> {
  const { question, ticker, period, connection, marketLines, pricedIn } = params;

  const fallback = fallbackReport({ ticker, period, connection, marketLines, pricedIn });
  if (connection.evidence.length === 0) {
    return { report: fallback, mode: "deterministic", issues: ["no evidence to report on"] };
  }

  const user = buildUser({
    question,
    ticker,
    connection,
    marketLines,
    pricedIn,
    priorSummary: params.priorSummary ?? null,
  });
  const system = await guidedSystem(CONTRACT);
  const knownIds = new Set(connection.evidence.map((e) => e.id));

  for (const { fn, name } of jsonProviders()) {
    for (const temperature of [0.35, 0.6]) {
      try {
        // A complete report measures ~24k characters, roughly 6k tokens. At the
        // previous 4000-token ceiling the model was truncated mid-JSON on every
        // attempt: the output was well-formed up to the cut, so it failed the
        // closing-brace check and surfaced as "non-JSON content" or, once parsed
        // loosely, as missing evidence ids. That looked like a prompt or parsing
        // bug and was neither. Headroom is deliberate — an over-long report is
        // cheap, a truncated one is worthless.
        const res = await fn({ system, user, maxTokens: 12_000, temperature, timeoutMs: 180_000 });
        const written = partialSchema.parse(parseJsonLoose(res.content));

        // Code owns evidence, chains, market lines and priced-in. The model
        // writes judgment only, so it cannot quietly restate a measured number
        // as its own conclusion or drop a source.
        const keepIds = (ids: string[]) => ids.filter((id) => knownIds.has(id));
        const report: IntelligenceReport = {
          ...written,
          ticker: written.ticker || ticker || "unresolved",
          period: written.period || period,
          evidence: connection.evidence,
          synthesis: {
            chains: connection.chains,
            notObvious: written.synthesis.notObvious || connection.notObvious,
            whatChanged: written.synthesis.whatChanged,
            contradictions:
              written.synthesis.contradictions.length > 0
                ? written.synthesis.contradictions
                : connection.contradictions,
          },
          implication: {
            immediate: { ...written.implication.immediate, evidenceIds: keepIds(written.implication.immediate.evidenceIds) },
            weeks: { ...written.implication.weeks, evidenceIds: keepIds(written.implication.weeks.evidenceIds) },
            months: { ...written.implication.months, evidenceIds: keepIds(written.implication.months.evidenceIds) },
            year: { ...written.implication.year, evidenceIds: keepIds(written.implication.year.evidenceIds) },
            marketLines,
            pricedIn: pricedIn.verdict,
            pricedInReason: pricedIn.reason,
          },
        };

        const issues = traceabilityIssues(report);
        console.log(
          `[report] ${name} t=${temperature}: ${report.scenarios.cases.length} scenario(s), ${issues.length} traceability issue(s)`,
        );
        return { report, mode: "llm", issues };
      } catch (err) {
        console.warn(
          `[report] ${name} t=${temperature} failed:`,
          err instanceof Error ? err.message.slice(0, 160) : err,
        );
      }
    }
  }

  console.warn("[report] all providers failed, returning evidence-only report");
  return {
    report: fallback,
    mode: "deterministic",
    issues: traceabilityIssues(fallback),
  };
}
