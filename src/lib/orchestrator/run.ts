import { db, ensureSchema, nowIso, newId } from "@/lib/db";
import {
  agents,
  dispatchAcks,
  inquiries,
  claims,
  evidenceRecords,
  opportunities,
} from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import {
  gradeClaims,
  sourceClusterKey,
  clamp01,
  round2,
  round4,
  type SubmittedClaim,
} from "./grade";
import { llmGradeClaims } from "./llm-grade";
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
import { buildEvidenceGraph, persistConnectionChains } from "./evidence-graph";
import { computeBreakdown, detectContradictions } from "./scoring";
import { runFollowUpRounds } from "./recurse";

/**
 * Sourcing window: how long the grid stays open for claims after dispatch.
 * Default 150s for a judge-safe cycle (was 300s, which pushed full runs past
 * 20 minutes with wave one plus follow-ups plus LLM retries). Set
 * PRIME_SOURCING_WINDOW_SECONDS up to 3600 (1 hour) when deep research is
 * worth waiting for. The readout is anchored on Base either way, so clients
 * always get a verifiable commitment.
 */
export const SOURCING_WINDOW_SECONDS = Math.min(
  3600,
  Math.max(60, Number(process.env["PRIME_SOURCING_WINDOW_SECONDS"] ?? 150)),
);

/**
 * Wave-one window: short broad sweep with no hypotheses. Its job is direction,
 * not completion. Wave two gets the sourcing window for the aimed hunt.
 * Default 45s (was 90s) so the two-wave total stays under ~3.5 minutes.
 */
export const WAVE1_WINDOW_SECONDS = Math.min(
  600,
  Math.max(30, Number(process.env["PRIME_WAVE1_WINDOW_SECONDS"] ?? 45)),
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

/**
 * Generic analytical filler — words a question uses to ask its question rather
 * than to name its subject.
 *
 * Agents derive three things from the question text, all of them keyword-driven:
 * the fallback search query, the relevance vocabulary, and the EDGAR full-text
 * topics. EDGAR takes only the FIRST TWO topic words, so a single filler word in
 * slot two spends an entire primary-source lookup on noise, and the relevance
 * gate is a substring match that waves through anything containing "change" or
 * "value". Together that is how 8-K filings from unrelated registrants ended up
 * as high-confidence claims in a run about NVDA.
 *
 * Only words that are never themselves a subject belong here. Terms like
 * "export", "controls" or "supply" must survive, because that is the actual
 * signal in a more specific question.
 */
const FILLER_TERMS = new Set(
  (
    "happening happen happens materially material world worldwide value values " +
    "change changes changing matter matters currently anything something everything " +
    "latest update updates news thing things going really actually"
  ).split(" "),
);

/**
 * Instruction verbs that frame a question without being part of its subject.
 * "Watch NVDA: ..." is an order to us, not a thing to search for.
 */
const FRAMING_PREFIX =
  /^\s*(?:please\s+)?(?:watch|watching|monitor|monitoring|track|tracking|follow|following|keep\s+an\s+eye\s+on)\b[\s:,-]*/i;

/**
 * The question as agents should read it for search terms: framing verb removed,
 * filler dropped, subject and word order intact.
 *
 * Normalized here, at the single dispatch funnel, rather than in each agent's
 * STOPWORDS set: that set is duplicated across nine separately deployed
 * services, so fixing it there would need nine redeploys to take effect. Safe to
 * reshape because no agent sends this text to a model — each one only tokenizes
 * it. The stored question is left untouched so the run still displays what was
 * asked.
 */
export function topicQuestion(question: string): string {
  const withoutFraming = question.replace(FRAMING_PREFIX, "").trim();
  const kept = withoutFraming
    .split(/\s+/)
    .filter((word) => {
      const bare = word.toLowerCase().replace(/[^a-z0-9]/g, "");
      return bare.length === 0 || !FILLER_TERMS.has(bare);
    })
    .join(" ")
    .trim();
  // Never hand back nothing: a question made entirely of framing and filler is
  // still better dispatched verbatim than as an empty string.
  return kept || withoutFraming || question.trim();
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

function parseWave(investigationJson: unknown): { wave: 1 | 2; wave2StartedAt: string | null } {
  try {
    const raw = typeof investigationJson === "string" ? JSON.parse(investigationJson) : investigationJson;
    if (raw?.wave === 2) {
      return {
        wave: 2,
        wave2StartedAt: typeof raw?.wave2StartedAt === "string" ? raw.wave2StartedAt : null,
      };
    }
    if (raw?.wave === 1) return { wave: 1, wave2StartedAt: null };
  } catch {}
  // Runs from before two-wave carry no marker. Treat them as wave two so the
  // poll grades them directly instead of opening a second sweep on old work.
  return { wave: 2, wave2StartedAt: null };
}

function buildRechecks(
  question: string,
  recall: RecallResult,
): { followup_id: number; company: string; agent_id: string; note: string; prior_claim: string | null }[] {
  const due = recall.dueFollowups.map((f) => ({
    followup_id: f.id,
    company: f.company,
    agent_id: f.agentId,
    note: f.note,
    prior_claim: f.priorClaim ?? null,
  }));
  const extra: typeof due = [];
  if (recall.similarPast.length > 0) {
    for (const c of recall.knownClaims) {
      if (!c.agentId) continue;
      extra.push({
        followup_id: -1,
        company: c.company,
        agent_id: c.agentId,
        note: `Additional lookup alongside fresh search for "${question.slice(0, 60)}": you flagged ${c.company} - "${c.claim}" on ${c.lastSeen.slice(0, 10)} (wasn't confirmed then). Check if active/ready now while you run your fresh search.`,
        prior_claim: c.claim,
      });
    }
  }
  return [...due, ...extra];
}

async function dispatchWave(params: {
  inquiryId: string;
  question: string;
  scope: { category?: string; geography?: string };
  submitUrl: string;
  windowSeconds: number;
  hypotheses?: import("./hypothesis").DemandHypothesis[];
  investigation?: import("./investigation").InvestigationState;
  warmBrief?: string;
  rechecks?: { followup_id: number; company: string; agent_id: string; note: string; prior_claim: string | null }[];
}): Promise<number> {
  await ensureSchema();
  const allAgents = await db.select().from(agents);
  const dispatched = agentsOnGrid(allAgents);
  await db
    .update(inquiries)
    .set({ agentsMatched: dispatched.length, updatedAt: nowIso() })
    .where(eq(inquiries.id, params.inquiryId));
  if (dispatched.length === 0) return 0;

  const base = {
    command_id: newId("CMD"),
    inquiry_id: params.inquiryId,
    question: topicQuestion(params.question),
    scope: params.scope,
    ...(params.hypotheses?.length ? { hypotheses: params.hypotheses } : {}),
    ...(params.investigation ? { investigation: params.investigation } : {}),
    window_seconds: params.windowSeconds,
    submit_url: params.submitUrl,
    ...(params.warmBrief ? { memory_brief: params.warmBrief } : {}),
  } as ResearchCommand;

  const results = await Promise.allSettled(
    dispatched.map((agent) => {
      const personal = (params.rechecks ?? []).filter((r) => r.agent_id === agent.id);
      const cmd: ResearchCommand =
        personal.length > 0 ? { ...base, command_id: newId("CMD"), memory_recheck: personal } : { ...base };
      for (const r of personal) {
        if (r.followup_id > 0) void markFollowupDispatched(r.followup_id);
      }
      return dispatchToAgent(agent.endpoint, cmd);
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
  return dispatched.length;
}

function submitUrlFromEnv(): string {
  if (process.env["PUBLIC_SUBMIT_URL"]) return `${process.env["PUBLIC_SUBMIT_URL"]}/api/claims/submit`;
  if (process.env["VERCEL_URL"]) return `https://${process.env["VERCEL_URL"]}/api/claims/submit`;
  return "http://localhost:8080/api/claims/submit";
}

function summarizeWaveOne(
  rows: { company: string; claim: string; evidenceJson: string }[],
): string {
  const lines: string[] = [];
  for (const r of rows.slice(0, 20)) {
    let sourceCount = 0;
    let observed = "";
    try {
      const ev = JSON.parse(r.evidenceJson) as { source?: string; observed?: string }[];
      sourceCount = Array.isArray(ev) ? ev.length : 0;
      observed = Array.isArray(ev) && ev[0]?.observed ? String(ev[0].observed) : "";
    } catch {}
    lines.push(
      `- ${r.company.slice(0, 60)} - ${r.claim.slice(0, 200)} (${sourceCount} sources${observed ? `, ${observed}` : ""})`,
    );
  }
  return lines.join("\n");
}

/**
 * Wave-one close: form hypotheses from what the grid actually returned, then
 * open the aimed wave-two window. Runs awaited inside the poll request so the
 * serverless function stays alive through dispatch.
 */
async function advanceToWave2(inquiryId: string): Promise<void> {
  const [inquiry] = await db.select().from(inquiries).where(eq(inquiries.id, inquiryId));
  if (!inquiry || inquiry.status !== "collecting") return;
  const parsed = parseWave(inquiry.investigationJson);
  if (parsed.wave !== 1) return;

  const wave1Rows = await db.select().from(claims).where(eq(claims.inquiryId, inquiryId));
  let recall: RecallResult = emptyRecall();
  try {
    recall = await recallForInquiry(inquiry.question);
  } catch (err) {
    console.error("wave-two recall skipped:", err);
  }

  let marketBlock = "";
  try {
    const companies = Array.from(new Set(wave1Rows.map((r) => r.company))).slice(0, 12);
    const snap = await buildMarketSnapshot(companies, inquiry.question, inquiry.identity ?? null);
    if (snap.lines.length > 0) marketBlock = snap.lines.join("\n");
  } catch {}

  let observation: string;
  if (wave1Rows.length > 0) {
    const parts = [
      `WAVE-ONE RETURNS (${wave1Rows.length} claims from the broad sweep):`,
      summarizeWaveOne(wave1Rows),
    ];
    if (marketBlock) parts.push(`TAPE:\n${marketBlock.slice(0, 900)}`);
    const mem = buildWarmBrief(recall);
    parts.push(`MEMORY: ${mem ?? "No related past runs or open claims."}`);
    parts.push(
      "Form hypotheses that explain these returns: overlaps across beats, gaps no beat covered, and contradictions to chase in wave two.",
    );
    observation = parts.join("\n");
  } else {
    try {
      const { observeQuestion } = await import("./observe");
      const probe = await observeQuestion(inquiry.question, recall);
      observation = `Wave one returned nothing, so this probe is the only ground. Do not assert events beyond it.\n${probe.text}`;
    } catch {
      observation = "Wave one returned nothing and the fallback probe failed. Hypothesize testably from the question alone.";
    }
  }

  let hypotheses: import("./hypothesis").DemandHypothesis[] = [];
  try {
    hypotheses = await generateHypotheses(inquiry.question, observation);
  } catch (err) {
    console.error("wave-two hypotheses failed, dispatching wave two open:", err);
  }

  const wave2StartedAt = nowIso();
  const investigation = buildInitialInvestigation(inquiry.question, hypotheses, {
    wave: 2,
    wave2StartedAt,
    observationText: observation,
  });
  const seen = new Set<string>();
  for (const r of wave1Rows) {
    const key = r.company.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      investigation.entities.push({ name: r.company.slice(0, 80), type: "company" });
    }
    try {
      const ev = JSON.parse(r.evidenceJson) as { item?: string; source?: string; observed?: string }[];
      for (const e of (Array.isArray(ev) ? ev : []).slice(0, 2)) {
        investigation.evidence.push({
          company: r.company.slice(0, 80),
          claim: String(e.item ?? r.claim).slice(0, 200),
          source: String(e.source ?? "").slice(0, 200),
          observed: String(e.observed ?? "").slice(0, 20),
        });
      }
    } catch {}
  }
  investigation.entities = investigation.entities.slice(0, 30);
  investigation.evidence = investigation.evidence.slice(0, 80);

  const scope = extractScope(inquiry.question);
  const windowClosesAt = new Date(Date.now() + SOURCING_WINDOW_SECONDS * 1000).toISOString();
  await db
    .update(inquiries)
    .set({ investigationJson: JSON.stringify(investigation), windowClosesAt, updatedAt: nowIso() })
    .where(eq(inquiries.id, inquiryId));

  const warmBrief = buildWarmBrief(recall);
  const submitUrl = submitUrlFromEnv();
  const count = await dispatchWave({
    inquiryId,
    question: inquiry.question,
    scope,
    submitUrl,
    windowSeconds: SOURCING_WINDOW_SECONDS,
    ...(hypotheses.length ? { hypotheses } : {}),
    investigation,
    ...(warmBrief ? { warmBrief } : {}),
    rechecks: [],
  });
  await db
    .update(inquiries)
    .set({
      investigationJson: JSON.stringify({ ...investigation, wave: 2 as const, wave2StartedAt }),
      updatedAt: nowIso(),
    })
    .where(eq(inquiries.id, inquiryId));
  console.log(
    `[wave] ${inquiryId} wave-one closed with ${wave1Rows.length} claims, ${hypotheses.length} hypotheses, wave-two open to ${count} agents`,
  );
  if (count === 0) {
    console.log(`[wave] ${inquiryId} no agents for wave two, grading on wave-one returns`);
    await gradeAndSynthesize(inquiryId);
  }
}

/**
 * Full inquiry lifecycle, two waves - serverless-safe split:
 *  wave-one sweep (short, no hypotheses) → hypotheses from returns →
 *  wave-two hunt (full window, aimed) → grade triggered later by polling
 *  or /api/cycles/resume. No long blocking wait inside the dispatch
 *  request; wave advance and grading run inside the request that triggers
 *  them. Sibyl recall shapes wave one, wave-one returns shape wave two.
 */
export async function runInquiry(inquiryId: string, submitUrl: string) {
  try {
    const [inquiry] = await db.select().from(inquiries).where(eq(inquiries.id, inquiryId));
    if (!inquiry) return;

    // Idempotency: terminal states never re-enter.
    if (inquiry.status === "complete" || inquiry.status === "failed") return;

    // Resume path - window closed. Wave one advances to wave two, wave two
    // grades. Both run AWAITED inside the caller (getInquiry poll or
    // /api/cycles/resume) so the serverless function stays alive.
    if (
      inquiry.status === "collecting" &&
      inquiry.windowClosesAt &&
      Date.now() > Date.parse(inquiry.windowClosesAt)
    ) {
      const { wave } = parseWave(inquiry.investigationJson);
      if (wave === 1) {
        console.log(`resuming orphaned cycle ${inquiryId} - wave-one window closed, advancing`);
        await advanceToWave2(inquiryId);
      } else {
        console.log(`resuming orphaned cycle ${inquiryId} - window closed, grading now`);
        await gradeAndSynthesize(inquiryId);
      }
      return;
    }

    // Already dispatched and still collecting - don't re-dispatch. The window
    // is open and agents are submitting; the poll advances or grades later.
    if (inquiry.status === "collecting") return;
    if (inquiry.status === "grading") return;

    // Fresh dispatch is always wave one: short, broad, no hypotheses. Agents
    // search from the question plus the memory brief and their own beat. The
    // hypotheses for wave two form from what this sweep returns. Do NOT block
    // waiting for claims. The UI poll advances to wave two once this window
    // closes or all agents respond.
    const scope = extractScope(inquiry.question);

    // Sibyl memory - recall BEFORE wave-one dispatch. Similar past inquiries,
    // open claims and due follow-ups change what goes out on the wire.
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
    const rechecks = buildRechecks(inquiry.question, recall);
    if (rechecks.length > 0) {
      console.log(
        `memory: ${rechecks.length} recheck(s) attached - ` +
          rechecks.map((r) => `${r.company} → ${r.agent_id}`).join(", "),
      );
    }

    const investigation = buildInitialInvestigation(inquiry.question, [], { wave: 1 });

    await db
      .update(inquiries)
      .set({
        category: scope.category ?? null,
        geography: scope.geography ?? null,
        investigationJson: JSON.stringify(investigation),
        status: "dispatching",
        updatedAt: nowIso(),
      })
      .where(eq(inquiries.id, inquiryId));

    const dispatchedAt = nowIso();
    const windowClosesAt = new Date(Date.now() + WAVE1_WINDOW_SECONDS * 1000).toISOString();

    // Open the wave-one window BEFORE commands go out - fast agents may
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

    const count = await dispatchWave({
      inquiryId,
      question: inquiry.question,
      scope,
      submitUrl,
      windowSeconds: WAVE1_WINDOW_SECONDS,
      investigation,
      ...(warmBrief ? { warmBrief } : {}),
      rechecks,
    });
    if (count === 0) {
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

    // No blocking wait - return immediately. Wave advance and grading are
    // triggered by the client's poll (getInquiry) or POST /api/cycles/resume
    // once each window closes or all agents have responded.
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
 * Two-wave poll driver. Wave one closing advances to the aimed wave two,
 * wave two closing grades. Early exits fire when every dispatched agent has
 * answered inside the current wave. Returns true when the caller should
 * refetch the inquiry after.
 */
/**
 * Longer than any single serverless invocation can survive, so a row idle for
 * this long is not "still working" — nothing is holding it.
 */
const STALLED_REPORT_MS = 300_000;

/**
 * Resume a run whose analysis pass never returned.
 *
 * Grading is made durable before the report pass begins, so a process that dies
 * between the two (invocation ceiling, redeploy, crash) leaves the row at
 * "grading" holding evidence but no report. Nothing else would ever move it: the
 * poll only advances "collecting" rows, which is how a run can sit unfinished.
 *
 * Three cases, in order of how much survived:
 *   - report stored: only the status write was lost, so adopt it and complete.
 *   - readout but no report: the analysis pass died. Complete with the reason
 *     rather than let the caller poll a dead run, and keep the evidence.
 *   - neither: grading itself died. Hand back to gradeAndSynthesize, which has
 *     its own staleness guard and will start the grade over.
 */
async function finishStalledReport(inquiry: typeof inquiries.$inferSelect): Promise<boolean> {
  if (inquiry.reportJson) {
    await db
      .update(inquiries)
      .set({ status: "complete", updatedAt: nowIso() })
      .where(eq(inquiries.id, inquiry.id));
    return true;
  }

  const updatedMs = inquiry.updatedAt ? Date.parse(inquiry.updatedAt) : 0;
  const idleMs = Date.now() - updatedMs;
  if (!Number.isFinite(idleMs) || idleMs < STALLED_REPORT_MS) return false;

  if (inquiry.readoutJson) {
    console.error(
      `[recover] ${inquiry.id} stalled in the analysis pass for ${Math.round(idleMs / 1000)}s — completing with evidence only`,
    );
    await db
      .update(inquiries)
      .set({
        status: "complete",
        error:
          "Evidence was collected and graded, but the analysis pass stopped before writing a report. The evidence below stands; re-run for a thesis.",
        updatedAt: nowIso(),
      })
      .where(eq(inquiries.id, inquiry.id));
    return true;
  }

  console.error(`[recover] ${inquiry.id} stalled before grading finished — retrying the grade`);
  await gradeAndSynthesize(inquiry.id);
  return true;
}

export async function tryGradeIfReady(inquiryId: string): Promise<boolean> {
  const [inquiry] = await db.select().from(inquiries).where(eq(inquiries.id, inquiryId));
  if (!inquiry) return false;
  if (inquiry.status === "grading") return finishStalledReport(inquiry);
  if (inquiry.status !== "collecting" || !inquiry.windowClosesAt) return false;
  const { wave, wave2StartedAt } = parseWave(inquiry.investigationJson);

  const windowClosed = Date.now() > Date.parse(inquiry.windowClosesAt);
  if (wave === 1) {
    if (windowClosed) {
      await advanceToWave2(inquiryId);
      return true;
    }
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
        console.log(`early wave advance ${inquiryId} - all ${dispatchedCount} agents answered wave one`);
        await advanceToWave2(inquiryId);
        return true;
      }
    }
    return false;
  }

  if (windowClosed) {
    await gradeAndSynthesize(inquiryId);
    return true;
  }

  // Early grading for wave two: only answers that arrived after the wave-two
  // window opened count. Without the timestamp filter the wave-one answers
  // would trigger instant grading and wave two would never get its window.
  if ((inquiry.agentsMatched ?? 0) > 0) {
    const dispatchedCount = inquiry.agentsMatched!;
    const since = wave2StartedAt ? Date.parse(wave2StartedAt) : 0;
    const [responded, acks] = await Promise.all([
      db
        .select({ agentId: claims.agentId, submittedAt: claims.submittedAt })
        .from(claims)
        .where(eq(claims.inquiryId, inquiryId)),
      db
        .select({ agentId: dispatchAcks.agentId, respondedAt: dispatchAcks.respondedAt })
        .from(dispatchAcks)
        .where(eq(dispatchAcks.inquiryId, inquiryId)),
    ]);
    const respondedIds = new Set([
      ...responded
        .filter((r) => !since || Date.parse(r.submittedAt) >= since)
        .map((r) => r.agentId),
      ...acks
        .filter((a) => !since || Date.parse(a.respondedAt) >= since)
        .map((a) => a.agentId),
    ]);
    if (respondedIds.size >= dispatchedCount) {
      console.log(`early grading ${inquiryId} - all ${dispatchedCount} agents answered wave two`);
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

    // Grading results are durable now, but the run does NOT claim to be
    // complete yet. The report is written below, and a poll that saw "complete"
    // here would hand back an empty result with no error to explain it.
    await db
      .update(inquiries)
      .set({
        status: "grading",
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

    // Connection pass - the analyst step. Runs on the FULL graded set so the
    // report is written from named causal chains rather than from truncated
    // claim rows. The readout is already stored, so a failure here costs the
    // report but not the evidence — it must still be reported, not swallowed.
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
      try {
        const persisted = await persistConnectionChains(inquiryId, connection.chains);
        console.log(
          `[graph] persisted ${persisted.nodes.length} entities, ${persisted.edges.length} chain edges`,
        );
      } catch (err) {
        console.error("chain persist failed (report continues):", err);
      }

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
      // The report is stored and the run is complete in the same write, so a
      // poll can never observe "complete" without the document it promises.
      await db
        .update(inquiries)
        .set({
          status: "complete",
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
      // The evidence survived, the analysis did not. Complete the run so it
      // stops polling, and say so on the row: a silent catch here is what
      // produced "complete" runs whose result was null with error also null.
      const detail = String((err as Error)?.message ?? err).slice(0, 300);
      console.error("connection pass failed (readout kept):", err);
      await db
        .update(inquiries)
        .set({
          status: "complete",
          error: `Evidence collected and graded, but the analysis pass failed, so there is no report for this run: ${detail}`,
          updatedAt: nowIso(),
        })
        .where(eq(inquiries.id, inquiryId));
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
