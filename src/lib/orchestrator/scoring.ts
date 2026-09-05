import type { GradedClaim } from "./grade";

export type ScoreBreakdown = {
  relevance: number;
  demandProbability: number;
  timing: number;
  scale: number;
  evidenceStrength: number;
  accessibility: number;
  freshness: number;
  competition: number;
  overall: number;
};

/**
 * Expanded scoring — maps graded dims to the 8 commercial dimensions from §11.
 * Keeps overall compatible with existing confidence (0-100) but exposes breakdown.
 */
export function computeBreakdown(list: GradedClaim[], hasContact: boolean): ScoreBreakdown {
  if (list.length === 0) {
    return { relevance: 0, demandProbability: 0, timing: 0, scale: 0, evidenceStrength: 0, accessibility: 0, freshness: 0, competition: 0, overall: 0 };
  }
  const avg = (fn: (g: GradedClaim) => number) => list.reduce((s, g) => s + fn(g), 0) / list.length;

  const relevance = Math.round(avg((g) => g.dims.relevance) * 100);
  const evidenceStrength = Math.round(avg((g) => (g.dims.quality + g.dims.independence) / 2) * 100);
  const demandProbability = Math.round(avg((g) => g.dims.relevance * g.dims.impact) * 100);
  const scale = Math.round(avg((g) => g.dims.impact) * 100);
  const accessibility = hasContact ? 85 : Math.round(avg((g) => g.dims.reliability) * 60);

  // Freshness: how recent is evidence (observed within 7 days = 90+, 30 days = 70, older decay)
  const now = Date.now();
  const freshnessVals = list.flatMap((g) => g.evidence.map((e) => {
    const ageDays = (now - Date.parse(e.observed)) / 86_400_000;
    if (!Number.isFinite(ageDays)) return 50;
    if (ageDays <= 7) return 95;
    if (ageDays <= 30) return 75;
    if (ageDays <= 90) return 55;
    return 35;
  }));
  const freshness = freshnessVals.length ? Math.round(freshnessVals.reduce((a, b) => a + b, 0) / freshnessVals.length) : 50;

  // Timing: procurement window — if claim mentions upcoming/current year or near-term phrasing, higher
  const timing = (() => {
    const year = new Date().getFullYear().toString();
    const nextYear = (new Date().getFullYear() + 1).toString();
    const re = new RegExp(`upcoming|Q[1-4]|${year}|${nextYear}|next month|soon`, "i");
    return list.some((g) => re.test(g.claim + (g.whyRelevant ?? ""))) ? 78 : 55;
  })();

  // Competition: inverse of duplication — more independent sources = less competition risk
  const distinct = new Set(list.flatMap((g) => g.evidence.map((e) => e.source))).size;
  const competition = distinct >= 3 ? 75 : distinct === 2 ? 60 : 45;

  const overall = Math.round((relevance * 0.22 + demandProbability * 0.18 + timing * 0.12 + scale * 0.12 + evidenceStrength * 0.15 + accessibility * 0.08 + freshness * 0.08 + competition * 0.05));

  return { relevance, demandProbability, timing, scale, evidenceStrength, accessibility, freshness, competition, overall };
}

export function detectContradictions(graded: GradedClaim[]): number {
  // Minimal: same company with claims that have conflicting date phrases
  const byCompany = new Map<string, GradedClaim[]>();
  for (const g of graded) {
    if (!byCompany.has(g.company)) byCompany.set(g.company, []);
    byCompany.get(g.company)!.push(g);
  }
  let contradictions = 0;
  for (const list of byCompany.values()) {
    if (list.length < 2) continue;
    const texts = list.map((g) => g.claim.toLowerCase());
    // Look for date conflicts like Dec 2026 vs Jun 2027, or completion dates differing
    const dateRe = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+20\d{2}\b/g;
    const dates = texts.flatMap((t) => [...t.matchAll(dateRe)].map((m) => m[0]));
    if (new Set(dates).size > 1) contradictions++;
    // Or status conflicts: "completed" vs "under construction"
    const hasCompleted = texts.some((t) => t.includes("completed"));
    const hasConstruction = texts.some((t) => t.includes("under construction") || t.includes("construction"));
    if (hasCompleted && hasConstruction) contradictions++;
  }
  return contradictions;
}
