import { db, ensureSchema, nowIso, newId } from "@/lib/db";
import {
  agents,
  dispatchAcks,
  inquiries,
  claims,
  creditLedger,
  evidenceRecords,
  opportunities,
  settlements,
} from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { INQUIRY_PRICING } from "@/lib/base/payments";
import {
  gradeClaims,
  sourceClusterKey,
  clamp01,
  round2,
  round4,
  type SubmittedClaim,
} from "./grade";
import { llmGradeClaims } from "./llm-grade";
import { buildSettlement, splitPayment } from "@/lib/base/payments";
import { settleCycle } from "@/lib/base/payouts";
import { synthesizeInquiry } from "./synthesize";
import { anchorRecord } from "@/lib/base/evidence-anchor";
import {
  recallForInquiry,
  buildWarmBrief,
  rememberCycle,
  markFollowupDispatched,
  emptyRecall,
  type RecallResult,
} from "@/lib/memory";
import { generateHypotheses } from "./hypothesis";
import { buildInitialInvestigation } from "./investigation";
import { connectEvidence } from "./connect";
import { writeReport } from "./write-report";
import { buildMarketSnapshot, extractTicker } from "@/lib/binance/market";
import { judgePricedIn, type PricedInJudgment } from "@/lib/binance/event-reaction";
import { buildEvidenceGraph } from "./evidence-graph";
import { computeBreakdown, detectContradictions } from "./scoring";
import { runFollowUpRounds } from "./recurse";

/**
 * Sourcing window: how long the grid stays open for claims after dispatch.
 * Default 5 minutes for quick cycles; set PRIME_SOURCING_WINDOW_SECONDS up to
 * 3600 (1 hour) when deep research is worth waiting for. The readout is
 * anchored on Base either way, so clients always get a verifiable commitment.
 */
export const SOURCING_WINDOW_SECONDS = Math.min(
  3600,
  Math.max(60, Number(process.env["PRIME_SOURCING_WINDOW_SECONDS"] ?? 300)),
);

// Controlled research graph traversal budgets (per §6)
export const MAX_DEPTH = Number(process.env["PRIME_MAX_DEPTH"] ?? 3);
export const MAX_SOURCES = Number(process.env["PRIME_MAX_SOURCES"] ?? 30);
export const TOKEN_BUDGET = Number(process.env["PRIME_TOKEN_BUDGET"] ?? 120000);

export type ResearchCommand = {
  command_id: string;
  inquiry_id: string;
  question: string;
  scope: { category?: string; geography?: string };
  hypotheses?: import("./hypothesis").DemandHypothesis[];
  investigation?: import("./investigation").InvestigationState;
  window_seconds: number;
  submit_url: string;
  /** Sibyl memory: warm brief + targeted re-checks. Absent on cold start. */
  memory_brief?: string;
  memory_recheck?: {
    followup_id: number;
    company: string;
    agent_id: string;
    note: string;
    prior_claim: string | null;
  }[];
};

/**
 * The grid has no taxonomy. Every online agent receives every command —
 * whether the inquiry fits is the agent's own intelligent decision, made
 * where its knowledge lives. Declining is normal and free.
 */
export function agentsOnGrid(all: { id: string; status: string; endpoint: string }[]) {
  return all.filter((agent) => agent.status === "online");
}

async function dispatchToAgent(endpoint: string, command: ResearchCommand): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command),
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

function extractScope(question: string): { category?: string; geography?: string } {
  const geoMatch = question.match(
    /\b(nigeria|ghana|kenya|south africa|egypt|germany|africa|lagos|europe|us|usa)\b/i,
  );
  const category = question
    .replace(/^i\s+(sell|have|offer)\s+/i, "")
    .split(/[.?!]/)[0]
    ?.slice(0, 80);
  return {
    ...(category ? { category } : {}),
    ...(geoMatch?.[0] ? { geography: geoMatch[0] } : {}),
  };
}

/**
 * Full inquiry lifecycle — serverless-safe split:
 *  dispatch → return immediately (window stays open) → grade triggered later
 *  by polling or /api/cycles/resume. No long blocking wait inside the
 *  dispatch request; grading runs inside the request that triggers it.
 *  Sibyl recall + hypothesis/investigation are woven into the dispatch
 *  so every agent gets both a warm brief and structured research guidance.
 */
export async function runInquiry(inquiryId: string, submitUrl: string) {
  try {
    const [inquiry] = await db.select().from(inquiries).where(eq(inquiries.id, inquiryId));
    if (!inquiry) return;

    // Idempotency: terminal states never re-enter.
    if (inquiry.status === "complete" || inquiry.status === "failed") return;

    // Resume path — window closed, claims already in DB. This is the ONLY
    // path that does heavy work (grade+synthesize). It runs AWAITED inside
    // the caller (getInquiry poll or /api/cycles/resume) so Vercel keeps the
    // function alive until it finishes.
    if (
      inquiry.status === "collecting" &&
      inquiry.windowClosesAt &&
      Date.now() > Date.parse(inquiry.windowClosesAt)
    ) {
      console.log(`resuming orphaned cycle ${inquiryId} — window closed, grading now`);
      await gradeAndSynthesize(inquiryId);
      return;
    }

    // Already dispatched and still collecting — don't re-dispatch. The window
    // is open and agents are submitting; grading will happen after it closes.
    if (inquiry.status === "collecting") return;
    if (inquiry.status === "grading") return;

    // Fresh dispatch path (status === dispatching). Do NOT block waiting for
    // claims — set the window, fire commands, and return. The UI poll will
    // trigger grading once the window closes (or early if all agents respond).
    const scope = extractScope(inquiry.question);

    // Sibyl memory — recall BEFORE dispatch. Similar past inquiries, open
    // claims and due follow-ups change what goes out on the wire.
    let recall: RecallResult = emptyRecall();
    try {
      recall = await recallForInquiry(inquiry.question);
      if (
        recall.similarPast.length > 0 ||
        recall.knownClaims.length > 0 ||
        recall.dueFollowups.length > 0
      ) {
        console.log(
          `memory recall for ${inquiryId}: ${recall.similarPast.length} similar, ` +
            `${recall.knownClaims.length} known claims, ${recall.dueFollowups.length} due follow-ups`,
        );
      }
    } catch (err) {
      console.error("memory recall skipped:", err);
    }
    const warmBrief = buildWarmBrief(recall);

    // Hypotheses: what demand could exist for this inventory — not just keyword replay
    let hypotheses: import("./hypothesis").DemandHypothesis[] = [];
    let investigation: import("./investigation").InvestigationState | null = null;
    try {
      hypotheses = await generateHypotheses(inquiry.question);
      investigation = buildInitialInvestigation(inquiry.question, hypotheses);
    } catch {}

    await db
      .update(inquiries)
      .set({
        category: scope.category ?? null,
        geography: scope.geography ?? null,
        investigationJson: investigation ? JSON.stringify(investigation) : null,
        status: "dispatching",
        updatedAt: nowIso(),
      })
      .where(eq(inquiries.id, inquiryId));

    await ensureSchema();
    const allAgents = await db.select().from(agents);
    const dispatched = agentsOnGrid(allAgents);

    await db
      .update(inquiries)
      .set({ agentsMatched: dispatched.length, updatedAt: nowIso() })
      .where(eq(inquiries.id, inquiryId));

    if (dispatched.length === 0) {
      await db
        .update(inquiries)
        .set({
          status: "complete",
          readoutJson: JSON.stringify([]),
          error: "No agents are on the grid yet.",
          updatedAt: nowIso(),
        })
        .where(eq(inquiries.id, inquiryId));
      return;
    }

    const dispatchedAt = nowIso();
    const windowClosesAt = new Date(Date.now() + SOURCING_WINDOW_SECONDS * 1000).toISOString();

    // Open the collection window BEFORE commands go out — fast agents may
    // submit within milliseconds of receiving the command.
    await db
      .update(inquiries)
      .set({
        status: "collecting",
        dispatchedAt,
        windowClosesAt,
        updatedAt: nowIso(),
      })
      .where(eq(inquiries.id, inquiryId));

    // Targeted re-checks: two sources
    // 1) due follow-ups (30d queue) — "yo I remember you"
    // 2) additional lookups — similar past search found this claim via this agent,
    //    so check it again alongside fresh search (not "don't start from zero", just "also check this one on your way")
    const dueRechecks = recall.dueFollowups.map((f) => ({
      followup_id: f.id,
      company: f.company,
      agent_id: f.agentId,
      note: f.note,
      prior_claim: f.priorClaim ?? null,
    }));
    const additionalRechecks: typeof dueRechecks = [];
    if (recall.similarPast.length > 0) {
      for (const c of recall.knownClaims) {
        if (!c.agentId) continue;
        // Only route to an agent that is actually on the grid this cycle
        additionalRechecks.push({
          followup_id: -1, // not a real follow-up, don't mark dispatched
          company: c.company,
          agent_id: c.agentId,
          note: `Additional lookup alongside fresh search for "${inquiry.question.slice(0, 60)}": you flagged ${c.company} — "${c.claim}" on ${c.lastSeen.slice(0, 10)} (wasn't confirmed then). Check if active/ready now while you run your fresh search.`,
          prior_claim: c.claim,
        });
      }
    }
    const rechecks = [...dueRechecks, ...additionalRechecks];
    if (rechecks.length > 0) {
      console.log(
        `memory: ${rechecks.length} recheck(s) attached (${dueRechecks.length} due + ${additionalRechecks.length} additional) — ` +
          rechecks.map((r) => `${r.company} → ${r.agent_id}`).join(", "),
      );
    }

    const command = {
      command_id: newId("CMD"),
      inquiry_id: inquiryId,
      question: inquiry.question,
      scope,
      hypotheses: hypotheses.length ? hypotheses : undefined,
      investigation: investigation ?? undefined,
      window_seconds: SOURCING_WINDOW_SECONDS,
      submit_url: submitUrl,
      ...(warmBrief ? { memory_brief: warmBrief } : {}),
    } as ResearchCommand;

    const results = await Promise.allSettled(
      dispatched.map((agent) => {
        const personalRechecks = rechecks.filter((r) => r.agent_id === agent.id);
        const agentCommand: ResearchCommand =
          personalRechecks.length > 0 ? { ...command, memory_recheck: personalRechecks } : { ...command };
        for (const r of personalRechecks) {
          if (r.followup_id > 0) void markFollowupDispatched(r.followup_id);
        }
        return dispatchToAgent(agent.endpoint, agentCommand);
      }),
    );
    results.forEach((r, i) => {
      const agent = dispatched[i]!;
      const ok = r.status === "fulfilled" && r.value;
      void db
        .update(agents)
        .set({ status: ok ? "online" : "offline", lastSeen: nowIso() })
        .where(eq(agents.id, agent.id));
    });

    // No blocking wait — return immediately. Grading is triggered by the
    // client's poll (getInquiry) or POST /api/cycles/resume once the window
    // closes or all agents have responded.
  } catch (error) {
    const [inq] = await db.select().from(inquiries).where(eq(inquiries.id, inquiryId));
    await db
      .update(inquiries)
      .set({
        status: "failed",
        error: error instanceof Error ? error.message : "Orchestrator failure",
        updatedAt: nowIso(),
      })
      .where(eq(inquiries.id, inquiryId));
  }
}

/**
 * Attempt to grade if the window has closed OR all dispatched agents have
 * already responded (early-exit optimization). Returns true if grading was
 * started (caller should refetch the inquiry after).
 * Used by getInquiry poll so the UI gets its readout without waiting the
 * full window when the grid is fast.
 */
export async function tryGradeIfReady(inquiryId: string): Promise<boolean> {
  const [inquiry] = await db.select().from(inquiries).where(eq(inquiries.id, inquiryId));
  if (!inquiry || inquiry.status !== "collecting" || !inquiry.windowClosesAt) return false;

  const windowClosed = Date.now() > Date.parse(inquiry.windowClosesAt);
  if (windowClosed) {
    await gradeAndSynthesize(inquiryId);
    return true;
  }

  // Early grading: all dispatched agents have responded before the window closed.
  if ((inquiry.agentsMatched ?? 0) > 0) {
    const dispatchedCount = inquiry.agentsMatched!;
    const [responded, acks] = await Promise.all([
      db.select({ agentId: claims.agentId }).from(claims).where(eq(claims.inquiryId, inquiryId)),
      db
        .select({ agentId: dispatchAcks.agentId })
        .from(dispatchAcks)
        .where(eq(dispatchAcks.inquiryId, inquiryId)),
    ]);
    const respondedIds = new Set([
      ...responded.map((r) => r.agentId),
      ...acks.map((a) => a.agentId),
    ]);
    if (respondedIds.size >= dispatchedCount) {
      console.log(`early grading ${inquiryId} — all ${dispatchedCount} agents responded`);
      await gradeAndSynthesize(inquiryId);
      return true;
    }
  }
  return false;
}

/**
 * Anchors one demand-graph opportunity on Base (fire-and-forget) and
 * stamps the merkle root / tx back onto its row. The dossier's permanent copy.
 */
function anchorOpportunity(opportunityId: string) {
  void (async () => {
    const [row] = await db.select().from(opportunities).where(eq(opportunities.id, opportunityId));
    if (!row) return;
    const result = await anchorRecord({
      kind: "opportunity",
      id: row.id,
      agent: "prime-orchestrator",
      claim: `${row.company}: ${row.need} @ ${Math.round(row.confidence)}% (${row.status})`,
      confidence: row.confidence,
      evidence: [
        {
          item: row.summary,
          source: `prime-layer://opportunity/${row.id}`,
          observed: nowIso().slice(0, 10),
        },
      ],
      ...(row.inquiryId ? { inquiry: row.inquiryId } : {}),
      observedAt: nowIso().slice(0, 10),
    });
    await db
      .update(opportunities)
      .set({
        anchorRoot: result.rootHash,
        ...(result.txHash ? { anchorTx: result.txHash } : {}),
      })
      .where(eq(opportunities.id, opportunityId));
  })().catch((err) => console.error(`opportunity anchor failed (${opportunityId}):`, err));
}

export async function gradeAndSynthesize(inquiryId: string) {
  await ensureSchema();
  const [inquiry] = await db.select().from(inquiries).where(eq(inquiries.id, inquiryId));
  if (!inquiry) return;

  // Idempotency: don't re-grade completed/failed, and don't double-grade when
  // two poll ticks race. Second caller sees grading in progress and backs off.
  if (inquiry.status === "complete" || inquiry.status === "failed") return;
  if (inquiry.status === "grading") {
    const updatedMs = inquiry.updatedAt ? Date.parse(inquiry.updatedAt) : 0;
    if (Date.now() - updatedMs < 60_000) {
      console.log(`gradeAndSynthesize skip — already grading ${inquiryId}`);
      return;
    }
    console.log(`gradeAndSynthesize stale grading detected, retrying ${inquiryId}`);
  }

  await db
    .update(inquiries)
    .set({ status: "grading", updatedAt: nowIso() })
    .where(eq(inquiries.id, inquiryId));

  try {
    let rawRows = await db.select().from(claims).where(eq(claims.inquiryId, inquiryId));
    let agentRows =
      rawRows.length === 0
        ? []
        : await db
            .select()
            .from(agents)
            .where(
              inArray(
                agents.id,
                rawRows.map((r) => r.agentId),
              ),
            );

    let agentMap: Record<string, { id: string; reliability: number }> = Object.fromEntries(
      agentRows.map((a) => [a.id, { id: a.id, reliability: a.reliability }]),
    );

    let submitted = rawRows.map((row) => ({
      agentId: row.agentId,
      company: row.company,
      claim: row.claim,
      confidence: row.confidence,
      evidence: JSON.parse(row.evidenceJson) as SubmittedClaim["evidence"],
      whyRelevant: (row as { whyRelevant?: string | null }).whyRelevant ?? null,
      contact: (row as { contact?: string | null }).contact ?? null,
    }));

    const { graded: initialGraded, totalClusters: initialTotal } = gradeClaims({ claims: submitted, agents: agentMap });

    // ── Recursive investigation: expand top signals into follow-up checks ──
    let graded: (typeof initialGraded) = initialGraded;
    let totalClusters = initialTotal;
    try {
      const invStateRaw = inquiry.investigationJson ? JSON.parse(inquiry.investigationJson as string) : null;
      const prelimContradictions = detectContradictions(initialGraded);
      if (invStateRaw && initialGraded.length > 0 && initialGraded.length < MAX_SOURCES) {
        const submitUrl =
          process.env["PUBLIC_SUBMIT_URL"]
            ? `${process.env["PUBLIC_SUBMIT_URL"]}/api/claims/submit`
            : process.env["VERCEL_URL"]
              ? `https://${process.env["VERCEL_URL"]}/api/claims/submit`
              : "http://localhost:8080/api/claims/submit";
        const scopeForFollowUp = extractScope(inquiry.question);
        const followUp = await runFollowUpRounds({
          inquiryId,
          question: inquiry.question,
          scope: scopeForFollowUp,
          submitUrl,
          initialGraded,
          initialSubmitted: submitted,
          initialInvestigation: invStateRaw,
          totalClusters: initialTotal,
          contradictions: prelimContradictions,
        });
        if (followUp.roundsRun > 0 && followUp.finalGraded.length > initialGraded.length) {
          if (followUp.finalInvestigation) {
            await db
              .update(inquiries)
              .set({ investigationJson: JSON.stringify(followUp.finalInvestigation), updatedAt: nowIso() })
              .where(eq(inquiries.id, inquiryId));
          }
          graded = followUp.finalGraded;
          const mergedClusters = new Set(graded.flatMap((g) => g.evidence.map((e) => sourceClusterKey(e.source)))).size;
          totalClusters = mergedClusters;
          console.log(`[recurse] accepted follow-up: ${followUp.newClaimsAdded} new claims, final graded ${graded.length}`);
          // Refresh DB rows so persistence (weight update) can find new claim ids
          rawRows = await db.select().from(claims).where(eq(claims.inquiryId, inquiryId));
          agentRows =
            rawRows.length === 0
              ? []
              : await db
                  .select()
                  .from(agents)
                  .where(inArray(agents.id, rawRows.map((r) => r.agentId)));
          agentMap = Object.fromEntries(agentRows.map((a) => [a.id, { id: a.id, reliability: a.reliability }]));
          submitted = rawRows.map((row) => ({
            agentId: row.agentId,
            company: row.company,
            claim: row.claim,
            confidence: row.confidence,
            evidence: JSON.parse(row.evidenceJson) as SubmittedClaim["evidence"],
            whyRelevant: (row as { whyRelevant?: string | null }).whyRelevant ?? null,
            contact: (row as { contact?: string | null }).contact ?? null,
          }));
        }
      }
    } catch (e) {
      console.error("[recurse] follow-up failed, continuing with initial grade:", e);
    }

    // The orchestrator's intelligence pass: LLM judges relevance/quality via 0G Compute Router
    const llm = await llmGradeClaims(
      inquiry.question,
      graded.map((g) => ({
        company: g.company,
        claim: g.claim,
        confidence: g.confidence,
        evidence: g.evidence,
      })),
    );
    if (llm.mode === "llm") {
      graded.forEach((g, i) => {
        const v = llm.verdicts[i];
        if (!v) return;
        g.dims.relevance = round2(clamp01(v.relevance));
        g.dims.quality = round2(Math.min(1, (clamp01(g.dims.quality) + clamp01(v.quality)) / 2));
        g.weight = round4(
          Math.max(
            0.05,
            g.dims.relevance *
              g.dims.quality *
              g.dims.independence *
              g.dims.reliability *
              g.dims.impact,
          ),
        );
      });
    }
    const llmNotes = new Map<string, string>(
      llm.mode === "llm"
        ? graded.flatMap((g, i) => {
            const v = llm.verdicts[i];
            return v?.note ? [[`${g.agentId}:${g.claim}`, v.note] as const] : [];
          })
        : [],
    );

    // Budgets — cap sources before scoring so one noisy agent can't drown the readout
    let cappedGraded = graded;
    if (graded.length > MAX_SOURCES) {
      cappedGraded = [...graded].sort((a, b) => b.weight - a.weight).slice(0, MAX_SOURCES);
      console.log(`capped ${graded.length} → ${MAX_SOURCES} claims (MAX_SOURCES)`);
    }
    // Evidence graph — relationships between entities and observations, not just flat claims
    void buildEvidenceGraph(inquiryId, cappedGraded).catch((err) => console.error("graph build failed:", err));
    const contradictions = detectContradictions(cappedGraded);

    // Reliability drift
    const tierByAgent = new Map<
      string,
      { discovery: number; confirmation: number; duplication: number }
    >();
    for (const g of cappedGraded) {
      const entry = tierByAgent.get(g.agentId) ?? { discovery: 0, confirmation: 0, duplication: 0 };
      entry[g.tier] += 1;
      tierByAgent.set(g.agentId, entry);
    }
    for (const [agentId, tiers] of tierByAgent) {
      const current = agentMap[agentId]?.reliability ?? 0.8;
      const total = tiers.discovery + tiers.confirmation + tiers.duplication;
      const discoveryRatio = total > 0 ? tiers.discovery / total : 0;
      const delta = discoveryRatio > 0.5 ? 0.01 : discoveryRatio === 0 && total > 0 ? -0.01 : 0;
      const next = Math.min(0.99, Math.max(0.5, current + delta));
      if (next !== current) {
        await db.update(agents).set({ reliability: next }).where(eq(agents.id, agentId));
      }
    }

    // Persist grades + canonical evidence records, each anchored on Base.
    for (const g of cappedGraded) {
      await db
        .update(claims)
        .set({
          tier: g.tier,
          weight: g.weight,
          dimsJson: JSON.stringify(g.dims),
          gradeMode: llm.mode,
          llmNote: llmNotes.get(`${g.agentId}:${g.claim}`) ?? null,
        })
        .where(
          eq(claims.id, rawRows.find((r) => r.agentId === g.agentId && r.claim === g.claim)!.id),
        );

      for (const ev of g.evidence) {
        const evidenceId = newId("EV");
        const agentName = agentRows.find((a) => a.id === g.agentId)?.name ?? g.agentId;
        await db
          .insert(evidenceRecords)
          .values({
            id: evidenceId,
            company: g.company,
            claim: ev.item,
            source: ev.source,
            sourceType: "agent submission",
            agent: agentName,
            observed: ev.observed,
            status: "verified",
            inquiryId,
            createdAt: nowIso(),
          })
          .onConflictDoNothing();

        void anchorRecord({
          kind: "evidence",
          id: evidenceId,
          agent: agentName,
          claim: `${g.company}: ${ev.item}`,
          confidence: g.confidence,
          evidence: [ev],
          ...(inquiry?.id ? { inquiry: inquiry.id } : {}),
          observedAt: ev.observed,
        })
          .then((result) =>
            db
              .update(evidenceRecords)
              .set({
                anchorRoot: result.rootHash,
                ...(result.txHash ? { anchorTx: result.txHash } : {}),
              })
              .where(eq(evidenceRecords.id, evidenceId)),
          )
          .catch((err) => console.error("anchor failed:", err));
      }
    }

    // Sibyl memory — remember phase
    void rememberCycle({
      inquiryId,
      question: inquiry.question,
      category: inquiry.category ?? null,
      geography: inquiry.geography ?? null,
      graded: cappedGraded.map((g) => ({
        agentId: g.agentId,
        company: g.company,
        claim: g.claim,
        confidence: g.confidence,
        evidence: g.evidence,
        tier: g.tier,
        weight: g.weight,
      })),
    });
    void rememberCycle; // keep import used if above void is tree-shaken? noop

    // Synthesize the readout: group by company, weight-scaled confidence.
    const byCompany = new Map<string, typeof cappedGraded>();
    for (const g of cappedGraded) {
      if (!byCompany.has(g.company)) byCompany.set(g.company, []);
      byCompany.get(g.company)!.push(g);
    }

    // Headlines are not companies. Agents sometimes promote a headline
    // fragment to the company slot ("From Crude to Compute", "Sponsored
    // Content", "If the GCC aims..."). Those entries never reach the readout:
    // a real company name is short, has no headline verbs, is not made
    // entirely of generic sector words, and never starts with a preposition,
    // conjunction, or sponsored tag.
    const HEADLINE_VERBS = new Set(
      "analyzing launches launched launch doubles doubled doubles raises raised raise cuts cut beats beat misses missed warns warned unveils unveiled posts posted reports reported says said plans planned wins won faces faced names named rebrand rebrands lifts lift picks picked".split(
        " ",
      ),
    );
    const GENERIC_BIZ = new Set(
      "ai tech big great new global top capex spending server servers spend spends market markets stock stocks data center cloud chip chips silicon semiconductor semiconductors memory shortage mania graphics card size locked lock industry sectors sector business businesses group power energy article news update report foregoing".split(
        " ",
      ),
    );
    const isHeadlineName = (name: string): boolean => {
      const clean = name.trim();
      if (/sponsored/i.test(clean)) return true;
      const words = clean.split(/\s+/);
      if (words.length > 5) return true;
      if (
        /^(from|if|to|as|at|on|in|with|after|before|during|while|when|where|how|why|what|and|but|or|for|by|of|the|a|an)\b/i.test(
          clean,
        )
      )
        return true;
      const tailPossessive = /\u2019s$|'s$/i.test(words[words.length - 1] ?? "");
      if (words.length > 1 && tailPossessive) return true;
      const tokens = words.map((t) => t.toLowerCase().replace(/[^a-z]/g, ""));
      if (tokens.some((t) => HEADLINE_VERBS.has(t))) return true;
      if (tokens.length > 0 && tokens.every((t) => GENERIC_BIZ.has(t))) return true;
      return false;
    };
    for (const name of Array.from(byCompany.keys())) {
      if (isHeadlineName(name)) byCompany.delete(name);
    }

    const readout = Array.from(byCompany.entries())
      .map(([company, list]) => {
        const totalWeight = list.reduce((sum, c) => sum + c.weight, 0);
        const confidence =
          totalWeight > 0
            ? Math.round(
                (list.reduce((sum, c) => sum + c.confidence * c.weight, 0) / totalWeight) * 100,
              )
            : 0;
        const clusters = new Set(
          list.flatMap((c) => c.evidence.map((e) => sourceClusterKey(e.source))),
        );
        const sorted = [...list].sort((a, b) => b.weight - a.weight);
        const top = sorted[0]!;
        const contact = sorted.find((c) => c.contact?.trim())?.contact?.trim() ?? null;
        const sourceMap = new Map<string, { label: string; url: string }>();
        for (const c of list) {
          for (const ev of c.evidence) {
            if (!ev.source) continue;
            const isUrl = /^https?:\/\//.test(ev.source);
            let label = "source";
            let url = ev.source;
            if (isUrl) {
              try {
                label = new URL(ev.source).hostname.replace(/^www\./, "");
              } catch {
                label = ev.source.slice(0, 40);
              }
              url = ev.source;
            } else {
              label = ev.source.slice(0, 60);
              url = ev.source;
            }
            const key = isUrl ? ev.source : ev.item || ev.source;
            if (!sourceMap.has(key)) sourceMap.set(key, { label, url });
          }
        }
        return {
          company,
          confidence,
          claims: list.length,
          independentSources: clusters.size,
          topClaim: top.whyRelevant?.trim() || top.claim,
          sources: Array.from(sourceMap.values()).slice(0, 6),
          contact,
          facts: sorted[0]!.evidence.map((e) => e.item).slice(0, 2),
          inferences: sorted
            .map((c) => c.whyRelevant?.trim())
            .filter(Boolean)
            .slice(0, 2) as string[],
          scoreBreakdown: computeBreakdown(list, !!contact),
          contributingAgents: Array.from(new Set(list.map((c) => c.agentId))),
        };
      })
      .sort((a, b) => b.confidence - a.confidence);

    // Upsert opportunities
    for (const entry of readout) {
      const existing = await db
        .select()
        .from(opportunities)
        .where(eq(opportunities.company, entry.company))
        .limit(1);

      if (existing.length > 0) {
        const row = existing[0]!;
        const best = Math.max(row.confidence, entry.confidence);
        await db
          .update(opportunities)
          .set({
            need: entry.topClaim,
            summary: entry.topClaim,
            confidence: best,
            contact: entry.contact ?? row.contact,
            status: best >= 80 ? "verified" : row.status === "verified" ? "verified" : "open",
            inquiryId,
          })
          .where(eq(opportunities.id, row.id));
        void anchorOpportunity(row.id);
        continue;
      }

      const oppId = newId("OPP");
      await db.insert(opportunities).values({
        id: oppId,
        company: entry.company,
        need: entry.topClaim,
        summary: entry.topClaim,
        confidence: entry.confidence,
        contact: entry.contact ?? null,
        status: entry.confidence >= 80 ? "verified" : "open",
        inquiryId,
        evidenceIdsJson: JSON.stringify([]),
        createdAt: nowIso(),
      });
      void anchorOpportunity(oppId);
    }

    // The contributor pool is the REAL payment the buyer made for this
    // inquiry (from the credit_ledger run_payment row), split 60/40. Free and
    // guest runs have no payment row — the platform funds their pool at the
    // standard price so agents still earn.
    let poolUsd = INQUIRY_PRICING.standardInquiryUsd * INQUIRY_PRICING.contributorPoolShare;
    const [payment] = await db
      .select()
      .from(creditLedger)
      .where(and(eq(creditLedger.inquiryId, inquiryId), eq(creditLedger.kind, "run_payment")));
    if (payment && Number((payment as any).paidNative ?? (payment as any).paidOg ?? 0) > 0) {
      const paidVal = Number((payment as any).paidNative ?? (payment as any).paidOg);
      poolUsd = splitPayment(paidVal).poolUsd;
    }
    const weightTotal = cappedGraded.reduce((s, g) => s + g.weight, 0);
    const settlementLines: { agentId: string; wallet: string; weight: number; amountUsd: number }[] =
      [];
    if (weightTotal > 0 && poolUsd > 0) {
      const insertedRowIds: number[] = [];
      for (const g of cappedGraded) {
        const wallet = agentRows.find((a) => a.id === g.agentId)?.wallet;
        if (!wallet) continue;
        const amountUsd = Math.round(poolUsd * (g.weight / weightTotal) * 100) / 100;
        settlementLines.push({ agentId: g.agentId, wallet, weight: g.weight, amountUsd });
        const [row] = await db
          .insert(settlements)
          .values({
            inquiryId,
            agentId: g.agentId,
            wallet,
            weight: g.weight,
            amountUsd,
            createdAt: nowIso(),
          })
          .returning({ id: settlements.id });
        if (row) insertedRowIds.push(row.id);
      }

      if (insertedRowIds.length > 0) {
        void settleCycle(
          settlementLines.map((l, i) => ({
            rowId: insertedRowIds[i]!,
            agentId: l.agentId,
            wallet: l.wallet,
            weight: l.weight,
          })),
        )
          .then(async (result) => {
            for (const a of result.attempted) {
              await db
                .update(settlements)
                .set(
                  a.txHash
                    ? { paidNative: Number((a as any).amountUsd ?? (a as any).amountOg), payoutTx: a.txHash, payoutError: null }
                    : { payoutError: a.error ?? "unknown payout failure" },
                )
                .where(inArray(settlements.id, a.rowIds));
            }
            const skippedNote = result.skipped.length ? ` (${result.skipped.length} skipped)` : "";
            console.log(
              `payouts settled for ${inquiryId}: ${result.totalPaidUsd?.toFixed(2) ?? result.totalPaidOg?.toFixed(6) ?? "0"} USDC on Base across ` +
                `${result.attempted.filter((a) => a.txHash).length} transfers${skippedNote}`,
            );
          })
          .catch((err) => console.error("payout pass failed:", err));
      }
    }

    if (settlementLines.length > 0) {
      void anchorRecord({
        kind: "settlement",
        id: inquiryId,
        agent: "prime-orchestrator",
        claim: `Cycle settlement · ${settlementLines.length} agents · ${settlementLines
          .reduce((s, l) => s + l.amountUsd, 0)
          .toFixed(2)} USD distributed`,
        evidence: settlementLines.map((l) => ({
          item: `${l.agentId} weight ${l.weight.toFixed(4)} → $${l.amountUsd.toFixed(2)}`,
          source: "prime-layer://settlements",
          observed: nowIso().slice(0, 10),
        })),
        observedAt: nowIso().slice(0, 10),
      })
        .then((result) =>
          db
            .update(settlements)
            .set({ tx: result.txHash ?? result.rootHash })
            .where(eq(settlements.inquiryId, inquiryId)),
        )
        .catch((err) => console.error("settlement anchor failed:", err));
    }

    await db
      .update(inquiries)
      .set({
        status: "complete",
        claimsReceived: cappedGraded.length,
        sourcesClustered: totalClusters,
        contradictions,
        gradeMode: llm.mode,
        gradeCostOg: (llm as any).costOg ?? null,
        gradeError: llm.error ?? null,
        readoutJson: JSON.stringify(readout),
        updatedAt: nowIso(),
      })
      .where(eq(inquiries.id, inquiryId));

    // Connection pass — the analyst step. Runs on the FULL graded set before
    // synthesis, so the report is written from named causal chains rather than
    // from four truncated claim rows. Failure here is not fatal: synthesis can
    // still write from the readout, it just has less to work with.
    try {
      // Market context for the connection pass. Best-effort: the chains are
      // about the events, and a missing snapshot must not cost us the analysis.
      let marketBlock = "";
      try {
        const snap = await buildMarketSnapshot(
          cappedGraded.map((g) => g.company),
          inquiry.question,
          inquiry.identity ?? null,
        );
        marketBlock = snap.lines.join("\n");
      } catch {
        // no snapshot, chains still stand on the evidence
      }
      const connection = await connectEvidence({
        question: inquiry.question,
        graded: cappedGraded,
        marketBlock,
      });
      await db
        .update(inquiries)
        .set({
          connectionJson: JSON.stringify(connection),
          connectMode: connection.mode,
          updatedAt: nowIso(),
        })
        .where(eq(inquiries.id, inquiryId));
      console.log(
        `[connect] ${connection.mode}: ${connection.evidence.length} events, ${connection.chains.length} chain(s)`,
      );

      // Report pass — one document, one assessment, written from the chains.
      // Priced-in is measured here (event dates against candles) rather than
      // asserted from a confidence threshold.
      const watched = extractTicker(inquiry.question.replace(/^watch\s+/i, ""));
      let pricedIn: PricedInJudgment = {
        verdict: "unclear",
        reason: "No ticker resolved for the watched name, so the tape could not be tested.",
        reactions: [],
      };
      if (watched) {
        try {
          const { getKlines } = await import("@/lib/binance/market-test");
          const candles = await getKlines(`${watched}BUSDT`, 120);
          const observedDates = cappedGraded.flatMap((g) => g.evidence.map((e) => e.observed));
          pricedIn = judgePricedIn({ observedDates, candles });
        } catch {
          // no candles: pricedIn stays unclear, which is the honest answer
        }
      }
      const written = await writeReport({
        question: inquiry.question,
        ticker: watched,
        period: `through ${nowIso().slice(0, 10)}`,
        connection,
        marketLines: marketBlock ? marketBlock.split("\n").filter(Boolean) : [],
        pricedIn,
      });
      await db
        .update(inquiries)
        .set({
          reportJson: JSON.stringify(written.report),
          reportMode: written.mode,
          updatedAt: nowIso(),
        })
        .where(eq(inquiries.id, inquiryId));
      console.log(
        `[report] ${written.mode}: pricedIn=${pricedIn.verdict}, ${written.issues.length} issue(s)`,
      );
      if (written.issues.length > 0) console.log(`[report] issues: ${written.issues.join(" | ")}`);
    } catch (err) {
      console.error("connection pass failed (synthesis continues):", err);
    }

    try {
      await synthesizeInquiry(inquiryId);
    } catch (err) {
      console.error("synthesis failed (readout kept):", err);
    }

    void anchorRecord({
      kind: "prediction",
      id: inquiryId,
      agent: "prime-orchestrator",
      claim: `Cycle readout · ${readout.length} companies · ${totalClusters} source clusters`,
      evidence: readout.map((entry) => ({
        item: `${entry.company} @ ${entry.confidence}% (${entry.independentSources} sources)`,
        source: `prime-layer://inquiry/${inquiryId}`,
        observed: nowIso().slice(0, 10),
      })),
      observedAt: nowIso().slice(0, 10),
    })
      .then((result) =>
        db
          .update(inquiries)
          .set({
            readoutAnchorRoot: result.rootHash,
            ...(result.txHash ? { readoutAnchorTx: result.txHash } : {}),
          })
          .where(eq(inquiries.id, inquiryId)),
      )
      .catch((err) => console.error("readout anchor failed:", err));
  } catch (err) {
    console.error("gradeAndSynthesize failed:", err);
    await db
      .update(inquiries)
      .set({
        status: "failed",
        error: err instanceof Error ? err.message : "Grading failure",
        updatedAt: nowIso(),
      })
      .where(eq(inquiries.id, inquiryId));
  }
}
