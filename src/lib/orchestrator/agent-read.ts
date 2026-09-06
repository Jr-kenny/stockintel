/**
 * Agent intelligence reads for outside agents. One shape in, one shape out,
 * behind both the MCP tools and the HTTP routes so the surfaces never drift.
 *
 * Reads serve the latest COMPLETED run matching a ticker, never a live grid
 * run: a full investigation takes minutes and spends credits, while a tool
 * call must answer in seconds. No assessment yet reads as an honest empty,
 * never a guess. Workspace identities never leave this module.
 */

import { z } from "zod";
import { db, ensureSchema } from "@/lib/db";
import { claims, inquiries } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { companyTickers, extractTicker } from "@/lib/binance/market";

const sourceSchema = z.object({ label: z.string(), url: z.string() });

const recommendationSchema = z.object({
  company: z.string(),
  title: z.string(),
  body: z.string(),
  confidence: z.number(),
  verdict: z.string().optional().default("unclear"),
  marketCall: z.string().optional().default(""),
  timeframe: z.string().optional().default(""),
  marketLines: z.array(z.string()).optional().default([]),
  sources: z.array(sourceSchema),
});

const synthesisSchema = z.object({
  preamble: z.string(),
  recommendations: z.array(recommendationSchema),
});

const readoutSchema = z.array(
  z.object({
    company: z.string(),
    confidence: z.number(),
    claims: z.number(),
    independentSources: z.number(),
    topClaim: z.string(),
    sources: z.array(sourceSchema).optional().default([]),
    contributingAgents: z.array(z.string()),
  }),
);

type Synthesis = z.infer<typeof synthesisSchema>;
type Readout = z.infer<typeof readoutSchema>;

type MatchedRun = {
  inquiryId: string;
  question: string;
  assessedAt: string;
  contradictions: number;
  synthesis: Synthesis;
  readout: Readout;
};

function normTicker(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, "");
}

/** Latest completed run whose question names the ticker. */
async function findRun(ticker: string): Promise<MatchedRun | null> {
  const runs = await listRuns(ticker);
  return runs[0] ?? null;
}

/** Every matching completed run, newest first. Question matches before thread matches. */
async function listRuns(ticker: string): Promise<MatchedRun[]> {
  const want = normTicker(ticker);
  if (!want) return [];
  await ensureSchema();
  const rows = await db
    .select()
    .from(inquiries)
    .where(eq(inquiries.status, "complete"))
    .orderBy(desc(inquiries.createdAt));
  const candidates: { row: (typeof rows)[number]; synthesis: Synthesis; readout: Readout }[] = [];
  for (const row of rows) {
    if (!row.synthesisJson) continue;
    let synthesis: Synthesis;
    try {
      synthesis = synthesisSchema.parse(JSON.parse(row.synthesisJson));
    } catch {
      continue;
    }
    let readout: Readout = [];
    try {
      readout = row.readoutJson ? readoutSchema.parse(JSON.parse(row.readoutJson)) : [];
    } catch {
      readout = [];
    }
    candidates.push({ row, synthesis, readout });
  }
  const toRun = (c: (typeof candidates)[number]): MatchedRun => ({
    inquiryId: c.row.id,
    question: c.row.question,
    assessedAt: c.row.updatedAt,
    contradictions: c.row.contradictions ?? 0,
    synthesis: c.synthesis,
    readout: c.readout,
  });
  const direct: MatchedRun[] = [];
  const threads: MatchedRun[] = [];
  for (const c of candidates) {
    if (extractTicker(c.row.question.replace(/^watch\s+/i, "")) === want) {
      direct.push(toRun(c));
      continue;
    }
    // Otherwise any assessment thread on the ticker counts.
    const hit =
      c.synthesis.recommendations.some((r) => companyTickers(r.company).includes(want)) ||
      c.readout.some((e) => companyTickers(e.company).includes(want));
    if (hit) threads.push(toRun(c));
  }
  return [...direct, ...threads];
}

export type AssessResult = {
  found: boolean;
  ticker: string;
  inquiryId: string | null;
  question: string | null;
  assessedAt: string | null;
  preamble: string;
  recommendations: Synthesis["recommendations"];
};

/** Full thesis for a ticker: preamble plus priced-or-not recommendations. */
export async function agentAssess(ticker: string): Promise<AssessResult> {
  const run = await findRun(ticker);
  if (!run) {
    return {
      found: false,
      ticker: normTicker(ticker),
      inquiryId: null,
      question: null,
      assessedAt: null,
      preamble: "",
      recommendations: [],
    };
  }
  return {
    found: true,
    ticker: normTicker(ticker),
    inquiryId: run.inquiryId,
    question: run.question,
    assessedAt: run.assessedAt,
    preamble: run.synthesis.preamble,
    recommendations: run.synthesis.recommendations,
  };
}

export type ClusterResult = {
  found: boolean;
  ticker: string;
  inquiryId: string | null;
  assessedAt: string | null;
  clusters: {
    company: string;
    confidence: number;
    claims: number;
    independentSources: number;
    topClaim: string;
    sources: { label: string; url: string }[];
    contributingAgents: string[];
  }[];
};

/** Cluster results only: grouped evidence per exposure, no thesis. */
export async function agentClusters(ticker: string): Promise<ClusterResult> {
  const run = await findRun(ticker);
  if (!run || run.readout.length === 0) {
    return {
      found: false,
      ticker: normTicker(ticker),
      inquiryId: null,
      assessedAt: null,
      clusters: [],
    };
  }
  return {
    found: true,
    ticker: normTicker(ticker),
    inquiryId: run.inquiryId,
    assessedAt: run.assessedAt,
    clusters: run.readout.map((e) => ({
      company: e.company,
      confidence: e.confidence,
      claims: e.claims,
      independentSources: e.independentSources,
      topClaim: e.topClaim,
      sources: e.sources,
      contributingAgents: e.contributingAgents,
    })),
  };
}

export type HistoryResult = {
  found: boolean;
  ticker: string;
  runs: { inquiryId: string; assessedAt: string; verdicts: { company: string; verdict: string; confidence: number }[] }[];
};

/** Every past assessment state for a ticker, newest first. */
export async function agentHistory(ticker: string): Promise<HistoryResult> {
  const runs = await listRuns(ticker);
  return {
    found: runs.length > 0,
    ticker: normTicker(ticker),
    runs: runs.map((r) => ({
      inquiryId: r.inquiryId,
      assessedAt: r.assessedAt,
      verdicts: r.synthesis.recommendations.map((rec) => ({
        company: rec.company,
        verdict: rec.verdict,
        confidence: rec.confidence,
      })),
    })),
  };
}

export type ChangesResult = {
  found: boolean;
  ticker: string;
  changed: boolean;
  direction: "strengthening" | "weakening" | "mixed" | "stable" | "unknown";
  currentAt: string | null;
  previousAt: string | null;
  flips: { company: string; from: string; to: string; confidenceFrom: number; confidenceTo: number }[];
  confidenceMoves: { company: string; from: number; to: number }[];
  added: string[];
  removed: string[];
  note: string;
};

const normCompany = (s: string): string => s.trim().toLowerCase();

/**
 * What changed between the last two assessments. Direction is a rough
 * heuristic from verdict moves and confidence drift, labeled as such.
 */
export async function agentThesisChanges(ticker: string): Promise<ChangesResult> {
  const empty: ChangesResult = {
    found: false,
    ticker: normTicker(ticker),
    changed: false,
    direction: "unknown",
    currentAt: null,
    previousAt: null,
    flips: [],
    confidenceMoves: [],
    added: [],
    removed: [],
    note: "",
  };
  const runs = await listRuns(ticker);
  if (runs.length === 0) {
    return { ...empty, note: `No completed assessment for ${normTicker(ticker)} yet.` };
  }
  const [current, previous] = [runs[0]!, runs[1]];
  if (!previous) {
    return {
      ...empty,
      found: true,
      currentAt: current.assessedAt,
      note: "Only one assessment on record. Nothing to compare yet.",
    };
  }
  const prevByCompany = new Map(previous.synthesis.recommendations.map((r) => [normCompany(r.company), r]));
  const currByCompany = new Map(current.synthesis.recommendations.map((r) => [normCompany(r.company), r]));
  const flips: ChangesResult["flips"] = [];
  const confidenceMoves: ChangesResult["confidenceMoves"] = [];
  let bullMoves = 0;
  let bearMoves = 0;
  for (const [key, curr] of currByCompany) {
    const prev = prevByCompany.get(key);
    if (!prev) continue;
    if (prev.verdict !== curr.verdict) {
      flips.push({
        company: curr.company,
        from: prev.verdict,
        to: curr.verdict,
        confidenceFrom: prev.confidence,
        confidenceTo: curr.confidence,
      });
      if (curr.verdict === "underpriced") bullMoves++;
      if (curr.verdict === "priced") bearMoves++;
    } else if (Math.abs(curr.confidence - prev.confidence) >= 10) {
      confidenceMoves.push({ company: curr.company, from: prev.confidence, to: curr.confidence });
      if (curr.confidence > prev.confidence) bullMoves++;
      else bearMoves++;
    }
  }
  const added = [...currByCompany.values()]
    .filter((r) => !prevByCompany.has(normCompany(r.company)))
    .map((r) => r.company);
  const removed = [...prevByCompany.values()]
    .filter((r) => !currByCompany.has(normCompany(r.company)))
    .map((r) => r.company);
  const changed = flips.length > 0 || confidenceMoves.length > 0 || added.length > 0 || removed.length > 0;
  const direction =
    !changed ? "stable"
    : flips.length === 0 && confidenceMoves.length === 0 ? "mixed"
    : bullMoves > 0 && bearMoves === 0 ? "strengthening"
    : bearMoves > 0 && bullMoves === 0 ? "weakening"
    : "mixed";
  return {
    found: true,
    ticker: normTicker(ticker),
    changed,
    direction,
    currentAt: current.assessedAt,
    previousAt: previous.assessedAt,
    flips,
    confidenceMoves,
    added,
    removed,
    note: "",
  };
}

export type ConflictingResult = {
  found: boolean;
  ticker: string;
  inquiryId: string | null;
  assessedAt: string | null;
  contradictions: number;
  against: { company: string; verdict: string; confidence: number; marketCall: string }[];
  weakestClusters: { company: string; confidence: number; claims: number; independentSources: number; topClaim: string }[];
  note: string;
};

/**
 * What argues against acting on the latest thesis, from stored data only:
 * priced and unclear threads, the weakest clusters, and the grading
 * contradiction count. Never invents a bearish case.
 */
export async function agentConflicting(ticker: string): Promise<ConflictingResult> {
  const run = await findRun(ticker);
  if (!run) {
    return {
      found: false,
      ticker: normTicker(ticker),
      inquiryId: null,
      assessedAt: null,
      contradictions: 0,
      against: [],
      weakestClusters: [],
      note: `No completed assessment for ${normTicker(ticker)} yet.`,
    };
  }
  const against = run.synthesis.recommendations
    .filter((r) => r.verdict !== "underpriced")
    .map((r) => ({ company: r.company, verdict: r.verdict, confidence: r.confidence, marketCall: r.marketCall }));
  const weakestClusters = [...run.readout]
    .sort((a, b) => a.independentSources - b.independentSources || a.confidence - b.confidence)
    .slice(0, 3)
    .map((e) => ({
      company: e.company,
      confidence: e.confidence,
      claims: e.claims,
      independentSources: e.independentSources,
      topClaim: e.topClaim,
    }));
  return {
    found: true,
    ticker: normTicker(ticker),
    inquiryId: run.inquiryId,
    assessedAt: run.assessedAt,
    contradictions: run.contradictions,
    against,
    weakestClusters,
    note:
      against.length === 0 && run.contradictions === 0
        ? "No stored thread argues against the latest thesis. Absence of contradiction is not confirmation."
        : "",
  };
}

export type EvidenceResult = {
  found: boolean;
  ticker: string;
  company: string | null;
  verdict: string | null;
  marketCall: string | null;
  sources: { label: string; url: string }[];
  cluster: {
    topClaim: string;
    claims: number;
    independentSources: number;
    contributingAgents: string[];
  } | null;
  claims: { claim: string; confidence: number; agent: string; evidence: { item: string; source: string }[] }[];
  note: string;
};

const evidenceSchema = z.array(z.object({ item: z.string(), source: z.string() }).passthrough());

/**
 * Drill from a thesis thread into its support: recommendation sources, the
 * matching evidence cluster, and the top underlying claims with evidence.
 * Company match is normalized; unknown companies read as an honest empty.
 */
export async function agentEvidence(ticker: string, company: string): Promise<EvidenceResult> {
  const empty: EvidenceResult = {
    found: false,
    ticker: normTicker(ticker),
    company: null,
    verdict: null,
    marketCall: null,
    sources: [],
    cluster: null,
    claims: [],
    note: "",
  };
  const run = await findRun(ticker);
  if (!run) return { ...empty, note: `No completed assessment for ${normTicker(ticker)} yet.` };
  const want = normCompany(company);
  const rec = run.synthesis.recommendations.find((r) => normCompany(r.company) === want);
  if (!rec) {
    return { ...empty, note: `No thesis thread on ${company} in the latest assessment.` };
  }
  const cluster = run.readout.find((e) => normCompany(e.company) === want) ?? null;
  let claimRows: EvidenceResult["claims"] = [];
  try {
    await ensureSchema();
    const rows = await db.select().from(claims).where(eq(claims.inquiryId, run.inquiryId));
    const mine = rows
      .filter((r) => normCompany(r.company) === want)
      .sort((a, b) => (b.weight ?? b.confidence) - (a.weight ?? a.confidence))
      .slice(0, 3);
    const { agents } = await import("@/lib/db/schema");
    const agentRows = await db.select().from(agents);
    const names = new Map(agentRows.map((a) => [a.id, a.name]));
    claimRows = mine.map((r) => {
      let evidence: { item: string; source: string }[] = [];
      try {
        evidence = evidenceSchema.parse(JSON.parse(r.evidenceJson)).map((e) => ({
          item: e.item.slice(0, 200),
          source: e.source.slice(0, 200),
        }));
      } catch {
        evidence = [];
      }
      return {
        claim: r.claim,
        confidence: r.confidence,
        agent: names.get(r.agentId) ?? r.agentId,
        evidence,
      };
    });
  } catch {
    claimRows = [];
  }
  return {
    found: true,
    ticker: normTicker(ticker),
    company: rec.company,
    verdict: rec.verdict,
    marketCall: rec.marketCall,
    sources: rec.sources,
    cluster: cluster
      ? {
          topClaim: cluster.topClaim,
          claims: cluster.claims,
          independentSources: cluster.independentSources,
          contributingAgents: cluster.contributingAgents,
        }
      : null,
    claims: claimRows,
    note: "",
  };
}
