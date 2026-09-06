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

/**
 * Trade press is recognised STRUCTURALLY, not by a list of names.
 *
 * A hardcoded roster would quietly privilege whatever sector it was written
 * for. Users watch shipping lines, banks, miners, pharma, utilities and cement
 * producers, and a list of semiconductor blogs is worth nothing to any of them.
 *
 * What actually generalises: specialist outlets carry a sector word in the
 * domain itself. lloydslist, pharmatimes, miningweekly, bankingdive,
 * offshore-energy, datacenterdynamics. So match the shape, not the name.
 */
const TRADE_MARKERS = [
  // Publication-type words that only appear in trade domains.
  "journal",
  "gazette",
  "weekly",
  "monthly",
  "daily",
  "review",
  "digest",
  "insider",
  "dive", // constructiondive, bankingdive, utilitydive, retaildive
  "wire",
  "brief",
  "report",
  "intelligence",
  "analysis",
  "newsletter",
  "magazine",
  "times",
  "post",
  "observer",
  "monitor",
  "tracker",
  // Sector words, deliberately broad and cross-industry.
  "trade",
  "industry",
  "market",
  "supply",
  "logistics",
  "shipping",
  "maritime",
  "freight",
  "aviation",
  "rail",
  "energy",
  "oil",
  "gas",
  "power",
  "utility",
  "mining",
  "metal",
  "steel",
  "chemical",
  "pharma",
  "medtech",
  "biotech",
  "health",
  "agri",
  "food",
  "retail",
  "property",
  "estate",
  "construction",
  "infra",
  "engineering",
  "manufactur",
  "automotive",
  "auto",
  "semiconductor",
  "datacenter",
  "telecom",
  "fintech",
  "banking",
  "insurance",
  "defense",
  "defence",
  "aerospace",
  "maritime",
  "textile",
  "cement",
  "timber",
  "paper",
  "packaging",
  "tech",
];

/**
 * Named specialists whose domains carry no sector marker. Short by design: the
 * structural test above is the general mechanism and this is only for outlets
 * that would otherwise be misread as personal blogs.
 */
const TRADE_HOSTS = [
  "semianalysis.com",
  "stratechery.com",
  "theinformation.com",
  "tomshardware.com",
  "anandtech.com",
  "theverge.com",
  "arstechnica.com",
  "techcrunch.com",
  "enr.com",
  "axios.com",
  "politico.com",
  "lloydslist.com",
  "tradewindsnews.com",
  "argusmedia.com",
  "platts.com",
  "fastmarkets.com",
  "endpts.com",
  "statnews.com",
  "fiercepharma.com",
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

/**
 * Regulator and government domains, by suffix rather than by name. A tender
 * board in Nigeria or a filing office in Chile is as primary as the SEC, and no
 * list of specific hosts would ever cover them.
 */
const PRIMARY_SUFFIXES = [".gov", ".govt.nz", ".gc.ca", ".europa.eu", ".int"];
/**
 * Anchored on a label boundary rather than a literal dot, so a bare apex domain
 * like gov.uk classifies the same as www.gov.uk. `(^|\.)` is the whole trick.
 */
const PRIMARY_PATTERNS = [
  /(^|\.)gov\.[a-z]{2,3}$/,
  /(^|\.)go\.[a-z]{2}$/,
  /(^|\.)gob\.[a-z]{2}$/,
  /(^|\.)gouv\.[a-z]{2}$/,
];

export function classifySource(source: string): SourceTier {
  const h = host(source);
  if (!h) return "general";

  // Primary: the company or a regulator speaking for itself.
  if (PRIMARY_HOSTS.some((p) => h.includes(p))) return "primary";
  if (PRIMARY_SUFFIXES.some((s) => h.endsWith(s))) return "primary";
  if (PRIMARY_PATTERNS.some((re) => re.test(h))) return "primary";

  // Aggregators before everything else: a recycler carrying a sector word in
  // its domain must not be promoted to trade.
  if (AGGREGATOR_HOSTS.some((p) => h.includes(p))) return "aggregator";

  if (WIRE_HOSTS.some((p) => h.includes(p))) return "wire";
  if (TRADE_HOSTS.some((p) => h.includes(p))) return "trade";

  // Structural trade test: specialist outlets name their beat in the domain.
  const stem = h.replace(/\.[a-z.]+$/, "");
  if (TRADE_MARKERS.some((m) => stem.includes(m))) return "trade";

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
