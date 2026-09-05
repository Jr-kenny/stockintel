import { db, nowIso, newId } from "@/lib/db";
import { agents, claims, dispatchAcks } from "@/lib/db/schema";
import { eq, inArray, gt } from "drizzle-orm";
import type { GradedClaim, SubmittedClaim } from "./grade";
import { gradeClaims } from "./grade";
import type { InvestigationState } from "./investigation";
import {
  updateInvestigationWithGraded,
  deriveFollowUpTasks,
  shouldRecurse,
  estimateInvestigationTokens,
} from "./investigation";
import type { ResearchCommand } from "./run";
import { MAX_DEPTH, MAX_SOURCES, TOKEN_BUDGET, SOURCING_WINDOW_SECONDS } from "./run";

const FOLLOWUP_WINDOW_SECONDS = Math.min(60, Math.max(30, Number(process.env["PRIME_FOLLOWUP_WINDOW_SECONDS"] ?? 40)));
const FOLLOWUP_SLEEP_MS = FOLLOWUP_WINDOW_SECONDS * 1000 + 2000; // dispatch time + buffer

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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
 * One follow-up round: dispatch derived tasks to specialist agents, wait, collect new claims.
 * Returns the new claims (if any) and whether to continue.
 */
export async function runFollowUpRounds(params: {
  inquiryId: string;
  question: string;
  scope: { category?: string; geography?: string };
  submitUrl: string;
  initialGraded: (GradedClaim & { agentId: string })[];
  initialSubmitted: (SubmittedClaim & { agentId: string })[];
  initialInvestigation: InvestigationState | null;
  totalClusters: number;
  contradictions: number;
}): Promise<{
  finalGraded: (GradedClaim & { agentId: string })[];
  finalInvestigation: InvestigationState | null;
  roundsRun: number;
  newClaimsAdded: number;
}> {
  let currentGraded = params.initialGraded;
  let currentSubmitted = params.initialSubmitted;
  let investigation = params.initialInvestigation;
  let tokenUsed = investigation ? estimateInvestigationTokens(investigation, currentGraded) : 0;
  let depth = investigation?.depth ?? 1;
  let roundsRun = 0;
  let newClaimsAdded = 0;
  let seenClaimIds = new Set<string>();

  // Initialize investigation with first round if not already
  if (investigation) {
    investigation = updateInvestigationWithGraded(investigation, currentGraded);
    tokenUsed = estimateInvestigationTokens(investigation, currentGraded);
  }

  // Track which claims we've already graded (by agentId+claim)
  const claimKey = (c: { agentId: string; claim: string }) => `${c.agentId}:${c.claim}`;

  while (depth < MAX_DEPTH) {
    const decision = shouldRecurse({
      graded: currentGraded,
      depth,
      tokenUsed,
      contradictions: params.contradictions,
      totalClusters: params.totalClusters,
      maxDepth: MAX_DEPTH,
      maxSources: MAX_SOURCES,
      tokenBudget: TOKEN_BUDGET,
    });

    if (!decision.should) {
      console.log(`[recurse] stop at depth ${depth}: ${decision.reason}`);
      break;
    }

    console.log(`[recurse] depth ${depth} → ${depth + 1}: ${decision.reason}`);

    if (!investigation) {
      console.log("[recurse] no investigation state, skipping follow-up");
      break;
    }

    const tasks = deriveFollowUpTasks(currentGraded, investigation);
    if (tasks.length === 0) {
      console.log("[recurse] no follow-up tasks derived");
      break;
    }

    console.log(`[recurse] derived ${tasks.length} follow-up tasks: ${tasks.map((t) => t.agent + ":" + t.objective.slice(0, 40)).join(" | ")}`);

    // Fetch specialist agents for each task
    const allAgents = await db.select().from(agents);
    const online = allAgents.filter((a) => a.status === "online");

    // Snapshot time before dispatch — new claims after this are follow-up
    const beforeIds = new Set((await db.select().from(claims).where(eq(claims.inquiryId, params.inquiryId))).map((r) => r.id));

    let dispatchedCount = 0;
    for (const task of tasks) {
      // Find best matching agent: name starts with task.agent
      const specialist = online.find((a) => a.name.toLowerCase().startsWith(task.agent.toLowerCase()) || a.name.toLowerCase().includes(task.agent.toLowerCase()));
      const target = specialist ?? online[0];
      if (!target) continue;

      const cmd = {
        command_id: newId("CMD"),
        inquiry_id: params.inquiryId,
        question: params.question,
        scope: params.scope,
        hypotheses: [
          {
            id: `H-FU-${dispatchedCount + 1}`,
            label: task.objective.slice(0, 60),
            demandType: task.objective,
            entityTypes: [],
            signals: task.searchHints,
            searchHints: task.searchHints,
            whatToVerify: [task.objective],
          },
        ],
        investigation,
        window_seconds: FOLLOWUP_WINDOW_SECONDS,
        submit_url: params.submitUrl,
      } as unknown as ResearchCommand;

      const ok = await dispatchToAgent(target.endpoint, cmd);
      if (ok) dispatchedCount++;
      // Small pacing to avoid thundering herd
      await sleep(300);
    }

    if (dispatchedCount === 0) {
      console.log("[recurse] no agents dispatched for follow-ups");
      break;
    }

    console.log(`[recurse] dispatched ${dispatchedCount} follow-up commands, waiting ${FOLLOWUP_WINDOW_SECONDS}s for claims...`);
    await sleep(FOLLOWUP_SLEEP_MS);

    // Collect new claims since beforeIds
    const allRows = await db.select().from(claims).where(eq(claims.inquiryId, params.inquiryId));
    const newRows = allRows.filter((r) => !beforeIds.has(r.id));

    if (newRows.length === 0) {
      console.log("[recurse] no new claims returned from follow-up");
      // No new evidence → update investigation to mark tasks done and stop (diminishing return)
      investigation = {
        ...investigation,
        tasks: investigation.tasks.map((t) => {
          const matched = tasks.some((ft) => t.objective.includes(ft.objective.slice(0, 20)));
          return matched ? { ...t, status: "skipped" as const } : t;
        }),
      };
      break;
    }

    console.log(`[recurse] got ${newRows.length} new claims from follow-up`);

    // Grade new claims together with existing (full re-grade to keep clustering correct)
    const agentRowsNew =
      newRows.length === 0
        ? []
        : await db
            .select()
            .from(agents)
            .where(inArray(agents.id, newRows.map((r) => r.agentId)));

    const agentMapNew = Object.fromEntries(agentRowsNew.map((a) => [a.id, { id: a.id, reliability: a.reliability }]));

    // Merge submitted lists: previous + new
    const newSubmitted: (SubmittedClaim & { agentId: string })[] = newRows.map((row) => ({
      agentId: row.agentId,
      company: row.company,
      claim: row.claim,
      confidence: row.confidence,
      evidence: JSON.parse(row.evidenceJson) as SubmittedClaim["evidence"],
      whyRelevant: (row as { whyRelevant?: string | null }).whyRelevant ?? null,
      contact: (row as { contact?: string | null }).contact ?? null,
    }));

    const mergedSubmitted = [...currentSubmitted, ...newSubmitted];
    const allAgentRows = [...(await db.select().from(agents).where(inArray(agents.id, mergedSubmitted.map((r) => r.agentId))))];
    const allAgentMap = Object.fromEntries(allAgentRows.map((a) => [a.id, { id: a.id, reliability: a.reliability }]));

    const { graded: reGraded, totalClusters: newTotal } = gradeClaims({ claims: mergedSubmitted, agents: allAgentMap });

    // Diminishing return check: did we gain meaningful new independent sources?
    const prevClusters = new Set(currentGraded.flatMap((g) => g.evidence.map((e) => e.source))).size;
    const nextClusters = new Set(reGraded.flatMap((g) => g.evidence.map((e) => e.source))).size;
    const clusterGain = nextClusters - prevClusters;

    if (clusterGain < 2 && reGraded.length - currentGraded.length < 2) {
      console.log(`[recurse] diminishing return: only ${clusterGain} new clusters, stopping`);
      break;
    }

    // Accept the merged grade as new current
    newClaimsAdded += newRows.length;
    currentGraded = reGraded;
    currentSubmitted = mergedSubmitted as typeof currentSubmitted;
    params.totalClusters = newTotal;

    // Update investigation state with new evidence
    investigation = updateInvestigationWithGraded(investigation, reGraded.filter((g) => newRows.some((r) => r.agentId === g.agentId && r.claim === g.claim)));
    tokenUsed = estimateInvestigationTokens(investigation, currentGraded);
    depth = investigation.depth ?? depth + 1;
    roundsRun++;

    console.log(`[recurse] round ${roundsRun} complete: ${newRows.length} new claims, ${clusterGain} new clusters, total graded ${currentGraded.length}, tokens ${tokenUsed}`);

    // Check token budget before next loop
    if (tokenUsed >= TOKEN_BUDGET) {
      console.log(`[recurse] token budget hit ${tokenUsed} >= ${TOKEN_BUDGET}`);
      break;
    }

    // Cap: don't loop forever in one grading call; max 2 follow-up rounds per cycle
    if (roundsRun >= 2) {
      console.log("[recurse] max follow-up rounds reached (2)");
      break;
    }
  }

  return {
    finalGraded: currentGraded,
    finalInvestigation: investigation,
    roundsRun,
    newClaimsAdded,
  };
}
