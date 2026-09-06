/**
 * The intelligence report — what the orchestrator produces.
 *
 * This replaces the per-company thesis. The old shape required `verdict`,
 * `marketCall` and `timeframe` on every entity, so a run that touched six
 * companies shipped six mini-theses, each with its own verdict, including
 * entities like "TSMC Is" that a headline regex invented. That is a news
 * summary wearing an analyst's clothes.
 *
 * The report is one document with one assessment. News is the evidence; the
 * report is the interpretation of the evidence. Sections in reading order:
 *
 *   1. executive     conclusion first, before any sources
 *   2. evidence[]    per event: source, what happened, why it matters, our read
 *   3. synthesis     what connects the events, what is not obvious, what changed
 *   4. implication   four horizons, immediate through 3-12 months
 *   5. scenarios     bull / base / bear, catalysts, risks, invalidation
 *   6. bottomLine    what to remember, what to watch, what would force a rethink
 *
 * Every factual claim traces to an evidence id. Confidence is banded with a
 * stated reason so "moderate" is explainable rather than decorative.
 */

import { z } from "zod";

export const sourceRefSchema = z.object({
  label: z.string(),
  url: z.string(),
  /** primary | wire | trade | general | aggregator — how close to the fact. */
  tier: z.string().optional().default("general"),
});

/**
 * One event. `whatHappened` is reporting and must not invent; `whyItMatters`
 * and `ourRead` are the analyst's, and are the reason this is not a feed.
 */
export const evidenceItemSchema = z.object({
  /** Stable handle (E1, E2 …) so synthesis and scenarios can cite it. */
  id: z.string(),
  headline: z.string(),
  entity: z.string(),
  observed: z.string(),
  /** Summary of the actual reporting. No invention. */
  whatHappened: z.string(),
  /** What this means in the context of the watched name's business. */
  whyItMatters: z.string(),
  /** The analyst's position on it. */
  ourRead: z.string(),
  confidence: z.enum(["high", "moderate", "low"]),
  /** Why that band: publisher tier, corroboration count, staleness. */
  confidenceReason: z.string(),
  sources: z.array(sourceRefSchema),
});

/**
 * A causal chain: the "A + B + C therefore D" that separates this from an
 * aggregator. Hops are named relationships between entities, each labeled by
 * how much is known versus reasoned.
 */
export const chainHopSchema = z.object({
  from: z.string(),
  relation: z.string(),
  to: z.string(),
  /** observed = in the evidence, inferred = follows from it, speculative = plausible. */
  basis: z.enum(["observed", "inferred", "speculative"]),
  /** Evidence ids supporting this hop. Empty is allowed only for speculative. */
  evidenceIds: z.array(z.string()).default([]),
});

export const chainSchema = z.object({
  claim: z.string(),
  hops: z.array(chainHopSchema),
  /** up | down | mixed | neutral for the watched name. */
  direction: z.enum(["up", "down", "mixed", "neutral"]),
  /** How much it would matter if correct. */
  magnitude: z.enum(["material", "moderate", "marginal"]),
  soWhat: z.string(),
});

export const horizonSchema = z.object({
  window: z.string(),
  assessment: z.string(),
  evidenceIds: z.array(z.string()).default([]),
});

export const scenarioSchema = z.object({
  case: z.enum(["bull", "base", "bear"]),
  probability: z.number().min(0).max(100),
  narrative: z.string(),
  /** What would have to happen for this to be the one. */
  requires: z.array(z.string()).default([]),
});

export const reportSchema = z.object({
  ticker: z.string(),
  period: z.string(),

  /** Conclusion first. The reader should not have to read 15 articles. */
  executive: z.object({
    whatHappened: z.string(),
    whyItMatters: z.string(),
    assessment: z.string(),
  }),

  evidence: z.array(evidenceItemSchema),

  synthesis: z.object({
    /** The connections. Individually weak, together meaningful. */
    chains: z.array(chainSchema),
    /** What a reader would miss reading the events one at a time. */
    notObvious: z.string(),
    /** Movement against the prior run, when there is one. */
    whatChanged: z.string(),
    /** Evidence that points the other way. Named, not buried. */
    contradictions: z.array(z.string()).default([]),
  }),

  implication: z.object({
    immediate: horizonSchema,
    weeks: horizonSchema,
    months: horizonSchema,
    year: horizonSchema,
    /** Measured market context: price, range position, volatility band. */
    marketLines: z.array(z.string()).default([]),
    /** Is the move already in the price, judged against event dates. */
    pricedIn: z.enum(["underpriced", "priced", "overpriced", "unclear"]),
    pricedInReason: z.string(),
  }),

  scenarios: z.object({
    cases: z.array(scenarioSchema),
    catalysts: z.array(z.string()).default([]),
    risks: z.array(z.string()).default([]),
    /** What would break the assessment. Makes the report falsifiable. */
    invalidation: z.array(z.string()).default([]),
  }),

  bottomLine: z.object({
    remember: z.string(),
    /** The single most important thing to watch next. */
    monitor: z.string(),
    reconsiderIf: z.string(),
  }),

  /** Overall confidence in the assessment, with its reason. */
  confidence: z.object({
    band: z.enum(["high", "moderate", "low"]),
    reason: z.string(),
  }),
});

export type SourceRef = z.infer<typeof sourceRefSchema>;
export type EvidenceItem = z.infer<typeof evidenceItemSchema>;
export type ChainHop = z.infer<typeof chainHopSchema>;
export type Chain = z.infer<typeof chainSchema>;
export type Horizon = z.infer<typeof horizonSchema>;
export type Scenario = z.infer<typeof scenarioSchema>;
export type IntelligenceReport = z.infer<typeof reportSchema>;

/**
 * Every evidence id a report cites, so callers can verify nothing was asserted
 * without a source behind it.
 */
export function citedEvidenceIds(report: IntelligenceReport): Set<string> {
  const ids = new Set<string>();
  for (const c of report.synthesis.chains) {
    for (const h of c.hops) for (const id of h.evidenceIds) ids.add(id);
  }
  for (const h of [
    report.implication.immediate,
    report.implication.weeks,
    report.implication.months,
    report.implication.year,
  ]) {
    for (const id of h.evidenceIds) ids.add(id);
  }
  return ids;
}

/**
 * Traceability check. Returns the problems rather than throwing, so a run can
 * ship a report that admits its own gaps instead of failing outright.
 */
export function traceabilityIssues(report: IntelligenceReport): string[] {
  const issues: string[] = [];
  const known = new Set(report.evidence.map((e) => e.id));

  for (const id of citedEvidenceIds(report)) {
    if (!known.has(id)) issues.push(`cites unknown evidence ${id}`);
  }
  for (const e of report.evidence) {
    if (e.sources.length === 0) issues.push(`evidence ${e.id} has no source`);
  }
  for (const c of report.synthesis.chains) {
    for (const h of c.hops) {
      if (h.basis !== "speculative" && h.evidenceIds.length === 0) {
        issues.push(`chain hop ${h.from} → ${h.to} claims ${h.basis} with no evidence`);
      }
    }
  }
  const total = report.scenarios.cases.reduce((s, c) => s + c.probability, 0);
  if (report.scenarios.cases.length > 0 && Math.abs(total - 100) > 15) {
    issues.push(`scenario probabilities sum to ${total}, not ~100`);
  }
  if (report.scenarios.invalidation.length === 0) {
    issues.push("no invalidation signal — assessment is not falsifiable");
  }
  return issues;
}
