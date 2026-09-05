/**
 * Sibyl memory layer — the substrate that makes intelligence compound.
 *
 * Six stores (see README "Sibyl memory layer"):
 *   1. Source Registry      — fingerprints of every source ever cited
 *   2. Claim Store          — claims about companies, open/confirmed/expired
 *   3. Reliability Ledger   — per-agent per-cycle contribution history
 *   4. Demand Graph nodes   — companies accumulating signal strength
 *   5. Inquiry Store        — past inquiries for similarity matching
 *   6. Follow-up Queue      — scheduled re-verifications ("yo I remember you")
 *
 * Design rules:
 *  - Memory is load-bearing: recallForInquiry() changes dispatch briefs and
 *    routing; delete this layer and confidence/independence math degrades.
 *  - Every public function is failure-isolated: a memory error logs and
 *    returns a safe default, never blocks an inquiry cycle.
 */

import { db, ensureSchema, nowIso, newId } from "@/lib/db";
import {
  memorySources,
  memoryClaims,
  memoryAgentHistory,
  memoryCompanies,
  memoryInquiries,
  memoryFollowups,
} from "@/lib/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { sourceClusterKey } from "@/lib/orchestrator/grade";

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "have",
  "has",
  "are",
  "was",
  "were",
  "you",
  "your",
  "our",
  "their",
  "this",
  "from",
  "into",
  "find",
  "need",
  "needs",
  "want",
  "who",
  "whom",
  "which",
  "what",
  "sell",
  "sells",
  "have",
  "available",
  "looking",
  "companies",
  "company",
  "business",
  "businesses",
]);

export function tokenize(question: string): string[] {
  return Array.from(
    new Set(
      question
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
    ),
  );
}

export type RecallResult = {
  similarPast: {
    inquiryId: string;
    question: string;
    createdAt: string;
    overlap: number;
    companies: string[];
  }[];
  knownClaims: {
    company: string;
    claim: string;
    status: string;
    agentId: string | null;
    bestConfidence: number;
    lastSeen: string;
  }[];
  dueFollowups: {
    id: number;
    company: string;
    agentId: string;
    note: string;
    priorClaim: string | null;
  }[];
};

/** Safe empty result — used on cold start or memory errors. */
export function emptyRecall(): RecallResult {
  return { similarPast: [], knownClaims: [], dueFollowups: [] };
}

/**
 * Recall phase — runs BEFORE dispatch. Everything here changes what the
 * orchestrator sends: warm briefs for everyone, targeted re-checks for the
 * agent that sourced the original intelligence.
 */
export async function recallForInquiry(question: string): Promise<RecallResult> {
  try {
    await ensureSchema();
    const tokens = tokenize(question);
    if (tokens.length === 0) return emptyRecall();

    // 1. Similar past inquiries (token overlap over stored token sets).
    const past = await db
      .select()
      .from(memoryInquiries)
      .orderBy(desc(memoryInquiries.createdAt))
      .limit(50);
    const similarPast = past
      .map((row) => {
        const pastTokens = JSON.parse(row.tokensJson) as string[];
        const hit = tokens.filter((t) => pastTokens.includes(t)).length;
        const union = new Set([...tokens, ...pastTokens]).size || 1;
        return {
          inquiryId: row.id,
          question: row.question,
          createdAt: row.createdAt,
          overlap: Math.round((hit / union) * 100),
          companies: JSON.parse(row.companiesJson) as string[],
        };
      })
      .filter((r) => r.overlap >= 20)
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, 3);

    // 2. Open claims worth carrying into the brief (recent signal first).
    const knownClaims = (
      await db
        .select()
        .from(memoryClaims)
        .where(eq(memoryClaims.status, "open"))
        .orderBy(desc(memoryClaims.lastSeen))
        .limit(8)
    ).map((c) => ({
      company: c.company,
      claim: c.claim,
      status: c.status,
      agentId: (c as unknown as { agentId?: string | null }).agentId ?? null,
      bestConfidence: c.bestConfidence,
      lastSeen: c.lastSeen,
    }));

    // 3. Follow-ups whose verification window has come due.
    const now = nowIso();
    const dueFollowups = (
      await db
        .select()
        .from(memoryFollowups)
        .where(and(eq(memoryFollowups.status, "pending"), sql`${memoryFollowups.dueAt} <= ${now}`))
        .limit(5)
    ).map((f) => ({
      id: f.id,
      company: f.company,
      agentId: f.agentId,
      note: f.note,
      priorClaim: f.priorClaim,
    }));

    return { similarPast, knownClaims, dueFollowups };
  } catch (err) {
    console.error("memory.recall failed:", err);
    return emptyRecall();
  }
}

/** Warm-brief text — now additive, not replacing fresh search. */
export function buildWarmBrief(recall: RecallResult): string | undefined {
  const parts: string[] = [];
  if (recall.knownClaims.length > 0) {
    parts.push(
      "Additional lookup alongside fresh search: " +
        recall.knownClaims
          .map((c) => `${c.company} — ${c.claim} (${c.bestConfidence}%)`)
          .join("; "),
    );
  }
  if (recall.similarPast.length > 0) {
    parts.push(
      `Related past inquiries exist (${recall.similarPast.length}); still run fresh search, just add the above check on your way.`,
    );
  }
  return parts.length > 0 ? parts.join(" | ") : undefined;
}

export type RememberedClaim = {
  agentId: string;
  company: string;
  claim: string;
  confidence: number;
  evidence: { item: string; source: string; observed: string }[];
  tier: "discovery" | "confirmation" | "duplication";
  weight: number;
};

/**
 * Remember phase — runs after grading, before settlement. Writes every store
 * and schedules follow-ups derived from timing windows.
 */
export async function rememberCycle(input: {
  inquiryId: string;
  question: string;
  category?: string | null;
  geography?: string | null;
  graded: RememberedClaim[];
}): Promise<void> {
  try {
    await ensureSchema();
    const now = nowIso();

    // ── 1. Source Registry ────────────────────────────────────────────────
    const citedSources = new Map<string, string>(); // clusterKey -> display
    for (const g of input.graded) {
      for (const ev of g.evidence) {
        citedSources.set(sourceClusterKey(ev.source), ev.source);
      }
    }
    for (const [key, display] of citedSources) {
      const existing = await db
        .select()
        .from(memorySources)
        .where(eq(memorySources.id, key))
        .limit(1);
      if (existing.length > 0) {
        const row = existing[0]!;
        const cycles = JSON.parse(row.cyclesJson) as string[];
        if (!cycles.includes(input.inquiryId)) cycles.push(input.inquiryId);
        await db
          .update(memorySources)
          .set({
            lastSeen: now,
            timesCited: row.timesCited + 1,
            cyclesJson: JSON.stringify(cycles),
          })
          .where(eq(memorySources.id, key));
      } else {
        await db
          .insert(memorySources)
          .values({
            id: key,
            displaySource: display,
            firstSeen: now,
            lastSeen: now,
            timesCited: 1,
            cyclesJson: JSON.stringify([input.inquiryId]),
          })
          .onConflictDoNothing();
      }
    }

    // ── 2. Claim Store + 4. Demand Graph nodes ───────────────────────────
    const byCompany = new Map<string, RememberedClaim[]>();
    for (const g of input.graded) {
      const list = byCompany.get(g.company) ?? [];
      list.push(g);
      byCompany.set(g.company, list);
    }

    for (const [company, list] of byCompany) {
      const top = list.slice().sort((a, b) => b.weight - a.weight)[0]!;
      const bestConfidence = Math.round(Math.max(...list.map((g) => g.confidence)) * 100);

      // Claim Store: merge by company+claim text.
      for (const g of list) {
        const existing = await db
          .select()
          .from(memoryClaims)
          .where(and(eq(memoryClaims.company, company), eq(memoryClaims.claim, g.claim)))
          .limit(1);
        if (existing.length > 0) {
          const row = existing[0]!;
          const inquiries = JSON.parse(row.inquiryIdsJson) as string[];
          if (!inquiries.includes(input.inquiryId)) inquiries.push(input.inquiryId);
          await db
            .update(memoryClaims)
            .set({
              bestConfidence: Math.max(row.bestConfidence, bestConfidence),
              lastSeen: now,
              inquiryIdsJson: JSON.stringify(inquiries),
              ...((row as unknown as { agentId?: string | null }).agentId
                ? {}
                : { agentId: g.agentId }),
            } as any)
            .where(eq(memoryClaims.id, row.id));
        } else {
          await (db.insert(memoryClaims) as any).values({
            company,
            claim: g.claim,
            status: "open",
            agentId: g.agentId,
            firstConfidence: g.confidence,
            bestConfidence,
            firstSeen: now,
            lastSeen: now,
            inquiryIdsJson: JSON.stringify([input.inquiryId]),
          });
        }
      }

      // Demand Graph node: one living record per company.
      const node = await db
        .select()
        .from(memoryCompanies)
        .where(eq(memoryCompanies.company, company))
        .limit(1);
      if (node.length > 0) {
        const row = node[0]!;
        const strength = Math.min(1, row.signalStrength + 0.05 * top.weight + 0.01);
        await db
          .update(memoryCompanies)
          .set({
            currentNeed: top.claim,
            signalStrength: strength,
            signalsCount: row.signalsCount + list.length,
            bestConfidence: Math.max(row.bestConfidence, bestConfidence),
            status: bestConfidence >= 80 ? "verified" : row.status,
            lastSignalAt: now,
          })
          .where(eq(memoryCompanies.company, company));
      } else {
        await db
          .insert(memoryCompanies)
          .values({
            company,
            currentNeed: top.claim,
            signalStrength: Math.min(1, 0.1 + 0.05 * top.weight),
            signalsCount: list.length,
            bestConfidence,
            status: bestConfidence >= 80 ? "verified" : "open",
            firstSignalAt: now,
            lastSignalAt: now,
          })
          .onConflictDoNothing();
      }

      // ── 6. Follow-up Queue ────────────────────────────────────────────
      // Schedule a re-verification ~30 days out with the strongest agent of
      // this cycle ("yo I remember you — did they finally commit?").
      const strongest = list.slice().sort((a, b) => b.weight - a.weight)[0]!;
      const due = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
      const open = await db
        .select()
        .from(memoryFollowups)
        .where(and(eq(memoryFollowups.company, company), eq(memoryFollowups.status, "pending")))
        .limit(1);
      if (open.length === 0) {
        await db.insert(memoryFollowups).values({
          company,
          agentId: strongest.agentId,
          note: `Re-verify ${company}: has the demand from "${input.question.slice(0, 60)}" converted? Check commitment, expansion, or walk-away.`,
          priorClaim: strongest.claim,
          priorConfidence: strongest.confidence,
          dueAt: due,
          createdAt: now,
        });
      }

      // Verified recalls: a previously dispatched follow-up for this company
      // answered by its assigned agent is memory proving itself useful.
      const dispatchedRows = await db
        .select()
        .from(memoryFollowups)
        .where(
          and(
            eq(memoryFollowups.company, company),
            eq(memoryFollowups.status, "dispatched"),
            eq(memoryFollowups.agentId, strongest.agentId),
          ),
        );
      for (const f of dispatchedRows) {
        await db
          .update(memoryFollowups)
          .set({ status: "done", resolvedAt: now })
          .where(eq(memoryFollowups.id, f.id));
        await db
          .update(memoryAgentHistory)
          .set({ verifiedRecalls: sql`${memoryAgentHistory.verifiedRecalls} + 1` })
          .where(
            and(
              eq(memoryAgentHistory.agentId, f.agentId),
              eq(memoryAgentHistory.inquiryId, input.inquiryId),
            ),
          );
      }
    }

    // ── 3. Reliability Ledger ─────────────────────────────────────────────
    const byAgent = new Map<string, RememberedClaim[]>();
    for (const g of input.graded) {
      const list = byAgent.get(g.agentId) ?? [];
      list.push(g);
      byAgent.set(g.agentId, list);
    }
    for (const [agentId, list] of byAgent) {
      await db.insert(memoryAgentHistory).values({
        agentId,
        inquiryId: input.inquiryId,
        discoveryCount: list.filter((g) => g.tier === "discovery").length,
        confirmationCount: list.filter((g) => g.tier === "confirmation").length,
        duplicationCount: list.filter((g) => g.tier === "duplication").length,
        weightSum: list.reduce((s, g) => s + g.weight, 0),
        createdAt: now,
      });
    }

    // ── 5. Inquiry Store ─────────────────────────────────────────────────
    await db
      .insert(memoryInquiries)
      .values({
        id: input.inquiryId,
        question: input.question,
        category: input.category ?? null,
        geography: input.geography ?? null,
        tokensJson: JSON.stringify(tokenize(input.question)),
        companiesJson: JSON.stringify(Array.from(byCompany.keys())),
        createdAt: now,
      })
      .onConflictDoNothing();

    console.log(
      `memory: remembered cycle ${input.inquiryId} — ${byCompany.size} companies, ` +
        `${citedSources.size} sources, ${byAgent.size} agent histories`,
    );
  } catch (err) {
    // Memory must never break a live inquiry cycle.
    console.error("memory.remember failed:", err);
  }
}

/** Mark a follow-up as dispatched (called when its command goes out). */
export async function markFollowupDispatched(followupId: number): Promise<void> {
  try {
    await db
      .update(memoryFollowups)
      .set({ status: "dispatched", dispatchedAt: nowIso() })
      .where(eq(memoryFollowups.id, followupId));
  } catch (err) {
    console.error("memory.markFollowupDispatched failed:", err);
  }
}

export { newId };
