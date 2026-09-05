import type { DemandHypothesis } from "./hypothesis";
import type { GradedClaim } from "./grade";

export type InvestigationState = {
  objective: string;
  inventoryHint: string;
  hypotheses: DemandHypothesis[];
  entities: { name: string; type: string; source?: string }[];
  evidence: { company: string; claim: string; source: string; observed: string }[];
  openQuestions: string[];
  tasks: { id: string; agent: string; objective: string; dependsOn?: string; status?: "open" | "done" | "skipped" }[];
  confidence: number;
  createdAt: string;
  depth?: number;
  tokenUsed?: number;
};

export function buildInitialInvestigation(question: string, hypotheses: DemandHypothesis[]): InvestigationState {
  const inventoryHint = question.slice(0, 120);
  return {
    objective: question,
    inventoryHint,
    hypotheses,
    entities: [],
    evidence: [],
    openQuestions: hypotheses.flatMap((h) => h.whatToVerify).slice(0, 10),
    tasks: hypotheses.slice(0, 4).map((h, i) => ({
      id: `T-${i + 1}`,
      agent: ["web-research", "project-intel", "social-signal", "procurement"][i % 4]!,
      objective: `Investigate: ${h.label} — ${h.signals[0] ?? h.demandType}`,
      status: "open" as const,
    })),
    confidence: 0,
    createdAt: new Date().toISOString(),
    depth: 0,
    tokenUsed: 0,
  };
}

/**
 * After each round, fold graded claims back into the investigation state.
 * Adds entities, evidence, answers some openQuestions, and bumps confidence.
 */
export function updateInvestigationWithGraded(
  state: InvestigationState,
  graded: GradedClaim[],
): InvestigationState {
  const existingEntities = new Set(state.entities.map((e) => e.name.toLowerCase()));
  const newEntities: InvestigationState["entities"] = [];
  const newEvidence: InvestigationState["evidence"] = [];

  for (const g of graded) {
    if (!existingEntities.has(g.company.toLowerCase())) {
      const src = g.evidence[0]?.source;
      newEntities.push(src ? { name: g.company, type: "company", source: src } : { name: g.company, type: "company" });
      existingEntities.add(g.company.toLowerCase());
    }
    for (const ev of g.evidence) {
      newEvidence.push({ company: g.company, claim: ev.item, source: ev.source, observed: ev.observed });
    }
  }

  // Average weight as confidence proxy (0-1 -> 0-100)
  const avgWeight = graded.length ? graded.reduce((s, g) => s + g.weight, 0) / graded.length : 0;
  const confidence = Math.round(Math.min(95, Math.max(state.confidence, avgWeight * 200)));

  // Mark tasks whose hypothesis was covered
  const tasks = state.tasks.map((t) => {
    const covered = graded.some((g) => g.claim.toLowerCase().includes(t.objective.toLowerCase().slice(0, 20)));
    return covered ? { ...t, status: "done" as const } : t;
  });

  // Keep openQuestions that are not yet answered
  const answeredQs = new Set<string>();
  for (const g of graded) {
    for (const q of state.openQuestions) {
      if (g.claim.toLowerCase().includes(q.toLowerCase().slice(0, 15))) answeredQs.add(q);
    }
  }
  const openQuestions = state.openQuestions.filter((q) => !answeredQs.has(q));

  return {
    ...state,
    entities: [...state.entities, ...newEntities].slice(0, 30),
    evidence: [...state.evidence, ...newEvidence].slice(0, 80),
    openQuestions,
    tasks,
    confidence,
    depth: (state.depth ?? 0) + 1,
  };
}

/**
 * Derive follow-up tasks from graded claims — the recursive graph traversal.
 * Each top company that showed a signal becomes a new investigation node:
 * who owns it, what's the project status, who supplies it, is procurement open?
 */
export function deriveFollowUpTasks(
  graded: GradedClaim[],
  state: InvestigationState,
): { agent: string; objective: string; searchHints: string[] }[] {
  // Strongest 3 companies by weight become follow-up nodes
  const top = [...graded].sort((a, b) => b.weight - a.weight).slice(0, 3);
  const tasks: { agent: string; objective: string; searchHints: string[] }[] = [];

  for (const g of top) {
    const company = g.company;
    // Skip if we've already investigated this company in depth
    const alreadyAsked = state.tasks.some((t) => t.objective.toLowerCase().includes(company.toLowerCase()));
    if (alreadyAsked && state.depth && state.depth >= 2) continue;

    // Company intel: verify the exposure link and scale
    tasks.push({
      agent: "company-intel",
      objective: `Verify ${company}: what connects it to the watched ticker and what is the scale?`,
      searchHints: [`${company} customer supplier relationship`, `${company} business scale`],
    });
    // Project intel: status, timeline, who benefits
    tasks.push({
      agent: "project-intel",
      objective: `Event status for ${company}: is the catalyst live and when does impact land?`,
      searchHints: [`${company} project status timeline`, `${company} expansion update`],
    });
    // Procurement: contracts that transmit exposure
    tasks.push({
      agent: "procurement",
      objective: `Contracts around ${company}: awarded deals or open tenders that move the chain?`,
      searchHints: [`${company} contract awarded`, `${company} tender deal`],
    });
  }

  // Verification for contradictions: if same company has conflicting dates/status, ask verification agent
  const byCompany = new Map<string, number>();
  for (const g of graded) byCompany.set(g.company, (byCompany.get(g.company) ?? 0) + 1);
  for (const [company, count] of byCompany) {
    if (count >= 2) {
      tasks.push({
        agent: "verification",
        objective: `Verify conflicting claims about ${company}: dates and event status`,
        searchHints: [`${company} event date confirmed`, `${company} latest update`],
      });
    }
  }

  // Deduplicate by objective
  const seen = new Set<string>();
  return tasks.filter((t) => {
    const key = t.objective.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 6);
}

export function shouldRecurse(params: {
  graded: GradedClaim[];
  depth: number;
  tokenUsed: number;
  contradictions: number;
  totalClusters: number;
  maxDepth: number;
  maxSources: number;
  tokenBudget: number;
}): { should: boolean; reason: string } {
  const { graded, depth, tokenUsed, contradictions, totalClusters, maxDepth, maxSources, tokenBudget } = params;

  if (depth >= maxDepth) return { should: false, reason: `depth ${depth} >= max ${maxDepth}` };
  if (graded.length >= maxSources) return { should: false, reason: `sources ${graded.length} >= max ${maxSources}` };
  if (tokenUsed >= tokenBudget) return { should: false, reason: `token budget ${tokenUsed} >= ${tokenBudget}` };
  if (graded.length === 0) return { should: false, reason: "no claims to follow up on" };

  // Thin evidence: less than 5 independent companies → worth digging deeper
  const distinctCompanies = new Set(graded.map((g) => g.company.toLowerCase())).size;
  if (distinctCompanies < 3 && depth === 1) return { should: true, reason: `thin evidence: only ${distinctCompanies} companies, digging deeper` };

  // Low average confidence → need verification
  const avgWeight = graded.reduce((s, g) => s + g.weight, 0) / graded.length;
  if (avgWeight < 0.15 && depth === 1) return { should: true, reason: `low confidence avg ${avgWeight.toFixed(3)}, verifying` };

  // Contradictions need resolution
  if (contradictions > 0) return { should: true, reason: `${contradictions} contradiction(s) to verify` };

  // Diminishing return: if we already have good coverage, stop
  if (totalClusters >= 8 && avgWeight > 0.25) return { should: false, reason: "good coverage, diminishing return" };

  // Default: one follow-up round if we still have budget and depth
  if (depth === 1) return { should: true, reason: "first follow-up round — expanding top signals" };

  return { should: false, reason: "depth 2+ and no strong signal to continue" };
}

export function estimateTokenUsage(text: string): number {
  // Rough: 1 token ~ 4 chars for English
  return Math.ceil(text.length / 4);
}

export function estimateInvestigationTokens(state: InvestigationState, graded: GradedClaim[]): number {
  const evidenceChars = graded.flatMap((g) => g.evidence.map((e) => e.item)).join(" ").length;
  const hypothesisChars = state.hypotheses.map((h) => JSON.stringify(h)).join(" ").length;
  const openQChars = state.openQuestions.join(" ").length;
  return Math.ceil((evidenceChars + hypothesisChars + openQChars) / 4);
}
