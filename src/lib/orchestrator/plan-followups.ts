import { z } from "zod";
import { jsonProviders } from "@/lib/llm/providers";
import { guidedSystem } from "./soul";
import type { GradedClaim } from "./grade";
import type { InvestigationState } from "./investigation";

export type FollowUpTask = {
  agent: string;
  objective: string;
  searchHints: string[];
};

const VALID_AGENTS = [
  "company-intel",
  "project-intel",
  "procurement",
  "verification",
  "web-research",
  "social-signal",
  "person-role",
  "media-youtube",
  "prime-signals",
] as const;

const taskSchema = z.object({
  agent: z.string(),
  objective: z.string(),
  searchHints: z.array(z.string()).default([]),
});

const responseSchema = z.object({
  tasks: z.array(taskSchema).default([]),
});

const CONTRACT = `Return ONLY one JSON object with EXACTLY one top-level key: tasks. No markdown, no prose.

tasks: array of 2-6 objects, EXACTLY these keys: agent, objective, searchHints.
  agent must be one of: company-intel, project-intel, procurement, verification, web-research, social-signal, person-role, media-youtube, prime-signals.
  objective is a single concrete check a specialist can run, naming the company and the gap to close.
  searchHints is 2 short queries the specialist can run verbatim.

Aim each task at a real gap: thin coverage, low weight claims that need a second source, contradictions to resolve, open questions nobody answered, or a causal link the evidence hints at but never confirms.
Do NOT emit the same company three times with generic verbs. One task per gap, strongest gaps first.
Prefer verification for date and status conflicts, procurement for contracts and tenders, project-intel for build status and timelines, company-intel for the link between a name and the watched ticker.`;

function parseJsonLoose(raw: string): unknown {
  const text = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("no JSON object in response");
    return JSON.parse(text.slice(start, end + 1));
  }
}

function cleanAgent(raw: string): string {
  const lower = raw.toLowerCase().trim();
  const hit = VALID_AGENTS.find((a) => lower === a || lower.includes(a) || a.includes(lower));
  return hit ?? "web-research";
}

function cleanTasks(list: unknown[]): FollowUpTask[] {
  const out: FollowUpTask[] = [];
  const seen = new Set<string>();
  for (const raw of list.slice(0, 8)) {
    const t = raw as Partial<FollowUpTask>;
    const objective = String(t.objective ?? "")
      .trim()
      .slice(0, 200);
    if (!objective) continue;
    const key = objective.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const hints = (Array.isArray(t.searchHints) ? t.searchHints : [])
      .map((h) => String(h).trim().slice(0, 80))
      .filter(Boolean)
      .slice(0, 2);
    out.push({
      agent: cleanAgent(String(t.agent ?? "web-research")),
      objective,
      searchHints: hints,
    });
    if (out.length >= 6) break;
  }
  return out;
}

/** Deterministic fallback: the old targeted loop, kept honest and capped. */
export function deterministicFollowUps(
  graded: GradedClaim[],
  state: InvestigationState,
): FollowUpTask[] {
  const top = [...graded].sort((a, b) => b.weight - a.weight).slice(0, 2);
  const tasks: FollowUpTask[] = [];
  for (const g of top) {
    const company = g.company;
    const alreadyAsked =
      state.tasks.some((t) => t.objective.toLowerCase().includes(company.toLowerCase())) &&
      (state.depth ?? 0) >= 2;
    if (alreadyAsked) continue;
    tasks.push({
      agent: "company-intel",
      objective: `Verify ${company}: what connects it to the watched ticker and what is the scale?`,
      searchHints: [`${company} customer supplier relationship`, `${company} business scale`],
    });
    tasks.push({
      agent: "project-intel",
      objective: `Event status for ${company}: is the catalyst live and when does impact land?`,
      searchHints: [`${company} project status timeline`, `${company} expansion update`],
    });
  }
  const byCompany = new Map<string, number>();
  for (const g of graded) byCompany.set(g.company, (byCompany.get(g.company) ?? 0) + 1);
  for (const [company] of byCompany) {
    if ((byCompany.get(company) ?? 0) >= 2) {
      tasks.push({
        agent: "verification",
        objective: `Verify conflicting claims about ${company}: dates and event status`,
        searchHints: [`${company} event date confirmed`, `${company} latest update`],
      });
    }
  }
  const seen = new Set<string>();
  return tasks
    .filter((t) => {
      const key = t.objective.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 4);
}

function buildInput(
  question: string,
  graded: GradedClaim[],
  state: InvestigationState,
  contradictions: number,
): string {
  const rows = graded.slice(0, 16).map((g) => ({
    company: g.company.slice(0, 60),
    claim: g.claim.slice(0, 180),
    weight: Number(g.weight.toFixed(3)),
    tier: g.tier,
    publishers: g.independentPublishers ?? 1,
    observed: g.evidence[0]?.observed ?? "",
  }));
  const parts = [
    `WATCHING: ${question.slice(0, 300)}`,
    `GRADED RETURNS (${rows.length}):`,
    ...rows.map((r) => JSON.stringify(r)),
    `CONTRADICTIONS FLAGGED: ${contradictions}`,
    `OPEN QUESTIONS: ${(state.openQuestions ?? []).slice(0, 8).join(" | ") || "none listed"}`,
    `ALREADY ASKED: ${
      (state.tasks ?? [])
        .slice(0, 8)
        .map((t) => t.objective.slice(0, 80))
        .join(" | ") || "none"
    }`,
    "Plan the next look. Each task must close one gap above, not repeat what was asked.",
  ];
  return parts.join("\n");
}

/**
 * LLM follow-up planner. Picks the next checks from real gaps in the graded
 * set instead of emitting the same company three times. Falls back to the
 * deterministic loop when every provider fails.
 */
export async function planFollowUps(params: {
  question: string;
  graded: GradedClaim[];
  state: InvestigationState;
  contradictions: number;
}): Promise<FollowUpTask[]> {
  const { question, graded, state, contradictions } = params;
  if (graded.length === 0) return [];
  const user = buildInput(question, graded, state, contradictions);
  const system = await guidedSystem(CONTRACT);
  for (const { fn, name } of jsonProviders()) {
    for (const temperature of [0.3, 0.6]) {
      try {
        const res = await fn({ system, user, maxTokens: 2000, temperature, timeoutMs: 60_000 });
        const parsed = responseSchema.parse(parseJsonLoose(res.content));
        const cleaned = cleanTasks(parsed.tasks);
        if (cleaned.length >= 2) {
          console.log(`[plan] ${name} t=${temperature}: ${cleaned.length} follow-up tasks`);
          return cleaned;
        }
        console.warn(`[plan] ${name} t=${temperature}: only ${cleaned.length} tasks, retrying`);
      } catch (err) {
        console.warn(
          `[plan] ${name} t=${temperature} failed:`,
          err instanceof Error ? err.message.slice(0, 140) : err,
        );
      }
    }
  }
  console.warn("[plan] all providers failed, using deterministic follow-ups");
  return deterministicFollowUps(graded, state);
}
