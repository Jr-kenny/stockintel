/**
 * Source quality, judged orchestrator-side.
 *
 * Grading used to take `quality` straight from the collector's own confidence
 * number, which meant a regex scraper's guess became a dimension of the
 * analyst's weighting. Collectors do not get to score their own findings. They
 * report what they found and where; quality is assessed here, where the full
 * evidence set is visible and the same yardstick applies to everyone.
 *
 * Three inputs, all observable from the evidence itself:
 *   tier      — what kind of source is this (primary filing, wire, trade, aggregator)
 *   freshness — how old is the observation
 *   corroboration — how many independent publishers carry it
 *
 * No LLM call. This has to run on every claim in every round, and a judgment
 * this mechanical does not need one.
 */

import type { SubmittedEvidence } from "./grade";
import { clamp01, round2, sourceClusterKey } from "./grade";

/**
 * Publisher tiers. Ordered by how close the source sits to the fact.
 *
 * primary  — the company or regulator speaking for itself, under legal penalty
 * wire     — agencies that employ reporters and issue corrections
 * trade    — specialist press, often earliest on a specific beat
 * general  — everything else that is a real publication
 * aggregator — recycles other people's reporting, cannot corroborate anything
 */
export type SourceTier = "primary" | "wire" | "trade" | "general" | "aggregator";

const PRIMARY_HOSTS = [
  "sec.gov",
  "efts.sec.gov",
  "federalregister.gov",
  "sam.gov",
  "ted.europa.eu",
  "europa.eu",
  "bis.doc.gov",
  "uspto.gov",
  "investor.",
  "ir.",
];

const WIRE_HOSTS = [
  "reuters.com",
  "apnews.com",
  "bloomberg.com",
  "ft.com",
  "wsj.com",
  "cnbc.com",
  "bbc.com",
  "npr.org",
  "nytimes.com",
  "economist.com",
];

const TRADE_HOSTS = [
  "datacenterdynamics.com",
  "constructiondive.com",
  "utilitydive.com",
  "enr.com",
  "semianalysis.com",
  "theinformation.com",
  "stratechery.com",
  "tomshardware.com",
  "anandtech.com",
  "techcrunch.com",
  "theverge.com",
  "arstechnica.com",
  "defensenews.com",
  "govconwire.com",
];

/**
 * Hosts that republish rather than report. Kept explicit rather than inferred:
 * an aggregator can still surface a real event, it just cannot be treated as
 * independent confirmation of one.
 */
const AGGREGATOR_HOSTS = [
  "news.google.com",
  "finance.yahoo.com",
  "msn.com",
  "seekingalpha.com",
  "fool.com",
  "investing.com",
  "benzinga.com",
  "marketbeat.com",
  "simplywall.st",
  "intellectia.ai",
  "stocktwits.com",
  "tipranks.com",
  "zacks.com",
  "insidermonkey.com",
];

const TIER_SCORE: Record<SourceTier, number> = {
  primary: 0.95,
  wire: 0.8,
  trade: 0.7,
  general: 0.5,
  aggregator: 0.3,
};

function host(source: string): string {
  return sourceClusterKey(source).split("/")[0] ?? "";
}

export function classifySource(source: string): SourceTier {
  const h = host(source);
  if (!h) return "general";
  if (PRIMARY_HOSTS.some((p) => h.includes(p))) return "primary";
  if (AGGREGATOR_HOSTS.some((p) => h.includes(p))) return "aggregator";
  if (WIRE_HOSTS.some((p) => h.includes(p))) return "wire";
  if (TRADE_HOSTS.some((p) => h.includes(p))) return "trade";
  return "general";
}

/** Distinct publishers behind a claim, aggregators excluded. */
export function independentPublishers(evidence: SubmittedEvidence[]): number {
  const hosts = new Set<string>();
  for (const ev of evidence) {
    if (classifySource(ev.source) === "aggregator") continue;
    const h = host(ev.source);
    if (h) hosts.add(h);
  }
  return hosts.size;
}

/**
 * Freshness on the observation date. A three-week-old headline is not evidence
 * of what is happening now, but it is not worthless either, so this decays
 * rather than cliffs.
 */
export function freshnessScore(observed: string): number {
  const ageDays = (Date.now() - Date.parse(observed)) / 86_400_000;
  if (!Number.isFinite(ageDays)) return 0.5;
  if (ageDays < 0) return 0.6; // future-dated: treat as suspect, not as fresh
  if (ageDays <= 2) return 1;
  if (ageDays <= 7) return 0.85;
  if (ageDays <= 21) return 0.65;
  if (ageDays <= 60) return 0.45;
  return 0.25;
}

export type QualityJudgment = {
  quality: number;
  bestTier: SourceTier;
  independentPublishers: number;
  freshest: number;
  /** Plain-language reason, so a low score is explainable in the report. */
  reason: string;
};

/**
 * Judge a claim's evidence. Best source carries the score, corroboration lifts
 * it, staleness pulls it down.
 */
export function judgeQuality(evidence: SubmittedEvidence[]): QualityJudgment {
  if (evidence.length === 0) {
    return {
      quality: 0,
      bestTier: "general",
      independentPublishers: 0,
      freshest: 0,
      reason: "no evidence attached",
    };
  }

  const tiers = evidence.map((ev) => classifySource(ev.source));
  const order: SourceTier[] = ["primary", "wire", "trade", "general", "aggregator"];
  const bestTier = order.find((t) => tiers.includes(t)) ?? "general";

  const freshest = Math.max(...evidence.map((ev) => freshnessScore(ev.observed)));
  const publishers = independentPublishers(evidence);

  // Base on the best source available, weighted by how current it is.
  let quality = TIER_SCORE[bestTier] * (0.6 + 0.4 * freshest);

  // Independent corroboration is the strongest signal that something is real.
  if (publishers >= 3) quality += 0.12;
  else if (publishers === 2) quality += 0.07;

  // Nothing but aggregators means nobody has independently reported this.
  if (publishers === 0) quality = Math.min(quality, 0.25);

  quality = clamp01(quality);

  const parts = [`best source ${bestTier}`];
  if (publishers === 0) parts.push("no independent publisher");
  else parts.push(`${publishers} independent publisher${publishers > 1 ? "s" : ""}`);
  if (freshest <= 0.45) parts.push("stale observation");
  else if (freshest === 1) parts.push("observed within 2 days");

  return {
    quality: round2(quality),
    bestTier,
    independentPublishers: publishers,
    freshest: round2(freshest),
    reason: parts.join(", "),
  };
}

/**
 * Confidence band for the report. The point of this is that the report can say
 * "moderate because the second source is an aggregator" instead of printing a
 * number nobody can trace.
 */
export function confidenceBand(j: QualityJudgment): "high" | "moderate" | "low" {
  if (j.quality >= 0.75 && j.independentPublishers >= 2) return "high";
  if (j.quality >= 0.5) return "moderate";
  return "low";
}
