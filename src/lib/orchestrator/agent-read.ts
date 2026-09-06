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
import { inquiries } from "@/lib/db/schema";
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
  synthesis: Synthesis;
  readout: Readout;
};

function normTicker(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, "");
}

/** Latest completed run whose question names the ticker. */
async function findRun(ticker: string): Promise<MatchedRun | null> {
  const want = normTicker(ticker);
  if (!want) return null;
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
  // The watch question names the ticker first.
  for (const c of candidates) {
    if (extractTicker(c.row.question.replace(/^watch\s+/i, "")) === want) {
      return {
        inquiryId: c.row.id,
        question: c.row.question,
        assessedAt: c.row.updatedAt,
        synthesis: c.synthesis,
        readout: c.readout,
      };
    }
  }
  // Otherwise any assessment thread on the ticker counts.
  for (const c of candidates) {
    const hit =
      c.synthesis.recommendations.some((r) => companyTickers(r.company).includes(want)) ||
      c.readout.some((e) => companyTickers(e.company).includes(want));
    if (hit) {
      return {
        inquiryId: c.row.id,
        question: c.row.question,
        assessedAt: c.row.updatedAt,
        synthesis: c.synthesis,
        readout: c.readout,
      };
    }
  }
  return null;
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
