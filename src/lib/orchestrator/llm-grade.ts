import { chatJson, computeRouterConfig } from "@/lib/0g/compute-router";
import { guidedSystem } from "./soul";

/**
 * The LLM grading pass — the orchestrator's intelligence on top of the
 * deterministic engine in grade.ts.
 *
 * What the LLM judges (per team spec, the dimensions the deterministic engine
 * cannot see):
 *   - relevance: could this event plausibly move the watched ticker?
 *   - quality:   how specific, checkable and recent is the cited evidence?
 *
 * What it deliberately does NOT judge:
 *   - duplication / independence — sources are clustered deterministically,
 *     and duplicate work is honest work that still earns.
 *   - reliability — that is the internal routing signal, drifted gently over
 *     cycles, never a public score and never an LLM opinion.
 *
 * Failure posture: the Router is an refinement, not a dependency. Any error
 * (no key, timeout, bad JSON) degrades to mode "deterministic" and the cycle
 * completes with the local engine's weights untouched.
 */

export type ClaimForLlmGrade = {
  company: string;
  claim: string;
  confidence: number;
  evidence: { item: string; source: string; observed: string }[];
};

export type ClaimVerdict = {
  relevance: number; // 0..1
  quality: number; // 0..1
  note: string;
};

export type LlmGradeOutcome = {
  mode: "llm" | "deterministic";
  model: string | undefined;
  costOg: number | undefined;
  error: string | undefined;
  /** Aligned 1:1 with the input array; entries stay undefined when ungraded. */
  verdicts: (ClaimVerdict | undefined)[];
};

const SYSTEM_PROMPT = `You are the grading engine of StockIntel, an event-driven equity intelligence network.
Independent research specialists investigate the world behind a watched ticker (they surface events plus cited evidence).
You grade each claim on two dimensions only:

- relevance (0.0-1.0): could this event plausibly change the watched ticker's value?
  Judge materiality and causal proximity, not topic similarity. Wrong company,
  no credible exposure path, or generic news that cannot reach the ticker = low.
  A concrete catalyst with a clear, short path to the ticker = high. A plausible
  but distant or small effect = middling, even if topically related.
- quality (0.0-1.0): how strong is the supporting evidence?
  Named companies, specific numbers, dated observations, primary sources (filings, tender boards, company posts with link) = high. Vague restatements, no clickable URL, or stale = low.

You do NOT judge duplication: several specialists citing the same source is honest, correct work — the network already clusters sources deterministically.
You do NOT score specialists. You grade individual claims only.

A claim that only repeats an analyst rating or price target, with no new
event or evidence behind it, scores low on quality no matter who said it.
We build our own analyst; consensus is not evidence.

Respond with JSON only, exactly this shape:
{"grades":[{"i":<claim index>,"relevance":<0.0-1.0>,"quality":<0.0-1.0>,"note":"<max 12 words, why this matters for the watched ticker>"}]}
Include every claim index. Never add prose outside the JSON.`;

/** Claims per Router call — keeps prompts small and one bad batch cheap. */
const CHUNK_SIZE = 20;
const MAX_CHUNKS = 5;

function clamp01(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : Number.NaN;
  return Number.isNaN(v) ? 0 : Math.min(1, Math.max(0, v));
}

function buildUserPrompt(question: string, claims: ClaimForLlmGrade[], offset: number): string {
  const lines = claims.map((c, i) =>
    JSON.stringify({
      i: i + offset,
      company: c.company,
      claim: c.claim,
      agent_confidence: c.confidence,
      evidence: c.evidence.map((ev) => ({
        item: ev.item,
        source: ev.source,
        observed: ev.observed,
      })),
    }),
  );
  return `BUYER INQUIRY:\n${question}\n\nAGENT CLAIMS:\n${lines.join("\n")}`;
}

function parseVerdicts(
  raw: string,
  expectedCount: number,
  offset: number,
): (ClaimVerdict | undefined)[] {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const parsed = JSON.parse(raw.slice(start, end + 1)) as {
    grades?: { i?: unknown; relevance?: unknown; quality?: unknown; note?: unknown }[];
  };
  const byIndex = new Map<number, ClaimVerdict>();
  for (const g of parsed.grades ?? []) {
    const i = typeof g.i === "number" ? g.i : Number.NaN;
    if (Number.isNaN(i) || i < offset || i >= offset + expectedCount) continue;
    byIndex.set(i, {
      relevance: clamp01(g.relevance),
      quality: clamp01(g.quality),
      note: typeof g.note === "string" ? g.note.slice(0, 160) : "",
    });
  }
  // Every claim in the chunk must come back; a partial answer grades nothing
  // in that chunk (callers fall back to deterministic values per claim).
  const out: (ClaimVerdict | undefined)[] = [];
  for (let i = 0; i < expectedCount; i++) out.push(byIndex.get(i + offset));
  return out;
}

/**
 * Grades all claims for one inquiry. One Router call per ~20 claims; the
 * whole grid's cycle typically costs a single small JSON completion.
 */
export async function llmGradeClaims(
  question: string,
  claims: ClaimForLlmGrade[],
): Promise<LlmGradeOutcome> {
  const config = computeRouterConfig();
  if (!config.live || claims.length === 0) {
    return {
      mode: "deterministic",
      model: undefined,
      costOg: undefined,
      error: undefined,
      verdicts: claims.map(() => undefined),
    };
  }

  const verdicts: (ClaimVerdict | undefined)[] = [];
  let costOg: number | undefined;
  let failures = 0;
  const chunks = Math.min(MAX_CHUNKS, Math.ceil(claims.length / CHUNK_SIZE));

  for (let chunk = 0; chunk < chunks; chunk++) {
    const offset = chunk * CHUNK_SIZE;
    const slice = claims.slice(offset, offset + CHUNK_SIZE);
    try {
      const result = await chatJson({
        system: await guidedSystem(SYSTEM_PROMPT),
        user: buildUserPrompt(question, slice, offset),
        maxTokens: 2000,
        temperature: 0,
      });
      verdicts.push(...parseVerdicts(result.content, slice.length, offset));
      if (result.costOg !== undefined) {
        costOg = (costOg ?? 0) + result.costOg;
      }
    } catch (error) {
      // Salvage complete grades from fenced or truncated output instead of
      // discarding the whole chunk.
      const raw = (error as { rawContent?: string }).rawContent ?? "";
      const salvaged = salvageVerdicts(raw, slice.length, offset);
      const filled: (ClaimVerdict | undefined)[] = slice.map(() => undefined);
      for (const [i, v] of salvaged) filled[i - offset] = v;
      verdicts.push(...filled);
      if (salvaged.length === 0) {
        failures++;
        console.error(
          "llm-grade chunk degraded to deterministic:",
          error instanceof Error ? error.message.slice(0, 160) : "LLM call failed",
        );
      }
    }
  }
  const graded = verdicts.filter((v) => v !== undefined).length;
  if (graded === 0) {
    return {
      mode: "deterministic",
      model: config.model,
      costOg,
      error: "all grading chunks failed",
      verdicts,
    };
  }
  return {
    mode: "llm",
    model: config.model,
    costOg,
    error: failures > 0 ? `${failures} chunk(s) fell back to deterministic` : undefined,
    verdicts,
  };
}

/** Pull complete grade objects out of fenced or truncated model output. */
function salvageVerdicts(
  text: string,
  expectedCount: number,
  offset: number,
): [number, ClaimVerdict][] {
  const out: [number, ClaimVerdict][] = [];
  const seen = new Set<number>();
  // Grades nest inside {"grades":[...]}, so scan every balanced pair.
  const stack: number[] = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === "{") {
      stack.push(i);
      continue;
    }
    if (ch === "}") {
      const start = stack.pop();
      if (start === undefined) continue;
      try {
        const g = JSON.parse(text.slice(start, i + 1)) as {
          i?: unknown;
          relevance?: unknown;
          quality?: unknown;
          note?: unknown;
        };
        if (typeof g.i === "number" && g.i >= offset && g.i < offset + expectedCount && !seen.has(g.i)) {
          seen.add(g.i);
          out.push([
            g.i,
            {
              relevance: clamp01(g.relevance),
              quality: clamp01(g.quality),
              note: typeof g.note === "string" ? g.note.slice(0, 160) : "",
            },
          ]);
        }
      } catch {
        // incomplete object — skip it, keep the complete ones
      }
    }
  }
  return out;
}
