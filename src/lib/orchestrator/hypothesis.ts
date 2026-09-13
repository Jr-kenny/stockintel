import { jsonProviders } from "@/lib/llm/providers";
import { guidedSystem } from "./soul";

export type DemandHypothesis = {
  id: string;
  label: string;
  demandType: string;
  entityTypes: string[];
  signals: string[];
  searchHints: string[];
  whatToVerify: string[];
};

/**
 * Open fallback hypotheses — used only when the LLM is unavailable.
 * Deliberately NOT a category checklist: the three moves are derived from
 * the watcher's own question text. Fixed buckets would make every run look
 * for the same story, which is the opposite of hypothesizing.
 */
const GENERIC_TEMPLATES: Omit<DemandHypothesis, "demandType" | "searchHints">[] = [
  {
    id: "H-DIRECT",
    label: "Direct developments",
    entityTypes: ["company", "regulator", "exchange"],
    signals: ["announcement naming the ticker", "filing disclosing material change", "analyst action"],
    whatToVerify: ["what actually happened", "when it happened", "primary source", "market reaction so far"],
  },
  {
    id: "H-CHAIN",
    label: "Exposure chain",
    entityTypes: ["customer", "supplier", "partner", "competitor"],
    signals: ["counterparty announces expansion", "contract awarded or lost", "supply disruption", "new partnership"],
    whatToVerify: ["the link to the ticker", "direction of effect", "magnitude", "timing"],
  },
  {
    id: "H-INVALIDATE",
    label: "Invalidation path",
    entityTypes: ["competitor", "regulator", "market"],
    signals: ["contradictory data", "bearish catalyst", "already-priced evidence"],
    whatToVerify: ["what would prove no edge", "what the market already knows", "contrary evidence"],
  },
];

function inventoryHintFromQuestion(question: string): string {
  // Prefer the named ticker ("Watch Xiaomi" -> "Xiaomi"), else a short clip.
  const tick = question.match(/watch(?:ing)?\s+([A-Za-z]{1,20})\b/i);
  if (tick?.[1]) return tick[1];
  const cleaned = question.replace(/\s+/g, " ").trim().slice(0, 80);
  return cleaned || "the watched ticker";
}

function topicsFromQuestion(question: string): string[] {
  const stop = new Set(
    "a an and are as at be been by for find from has have how i in into is it its me my of on or our sell selling show that the their them they this to us want was we what which who will with you your".split(
      " ",
    ),
  );
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stop.has(w) && !/^\d+$/.test(w))
    .slice(0, 4);
}

function deterministicHypotheses(question: string): DemandHypothesis[] {
  const hint = inventoryHintFromQuestion(question);
  const topics = topicsFromQuestion(question);
  const topicSuffix = topics.length ? topics.slice(0, 2).join(" ") : "";
  // Turn generic templates into exposure-aware hypotheses without hardcoding any sector.
  return GENERIC_TEMPLATES.map((t) => {
    const baseHints = t.signals.slice(0, 2).map((s) => (topicSuffix ? `${s} ${topicSuffix}` : s));
    return {
      ...t,
      demandType: `${t.label.toLowerCase()} — could move ${hint} through the exposure chain`,
      searchHints: baseHints,
    };
  });
}

const SYSTEM = `You are the hypothesis generator for an event-driven equity intelligence network.
Given the watcher's objective and watched ticker, generate 3-5 exposure hypotheses.

Your reasoning objective, not a checklist:

Given an asset, identify events in the external world that could materially
change the asset's economic value. Do not assume where those events originate.
Construct and expand the asset's economic exposure graph dynamically. Follow
relationships wherever the evidence leads: customers, suppliers, competitors,
partners, infrastructure, regulators, contracts, projects, commodities,
financing, capacity, geography, technology. Never restrict investigation to
predefined entities or categories. Expand whenever newly discovered evidence
creates a meaningful connection.

Prioritize hypotheses by: economic materiality, causal proximity, magnitude,
probability, timing, novelty, evidence quality.

Each hypothesis must be:
- a plausible way the ticker could be moved by events (not just pages containing the company name)
- tied to entity types whose actions transmit exposure
- described by observable signals
- with search hints an investigator could use
- and what to verify before it becomes an assessment

Return JSON: { "hypotheses": [{ "label": string, "demandType": string, "entityTypes": string[], "signals": string[], "searchHints": string[], "whatToVerify": string[] }] }

Rules:
- ground every hypothesis in the OBSERVED block when one is present: reference the tape, the headlines, or the wave-one returns by name, and never invent an event the observation does not contain
- demandType should be concrete: what event and what exposure path could move the ticker, and why, derived from the watcher's actual question, never a preset bucket
- entityTypes 2-4 items
- signals 3-5 items, observable public signals
- searchHints 2-3 short queries an investigator can run verbatim
- whatToVerify 3-5 items
- Keep labels short (2-4 words)
- Do not invent tickers you were not given; use what the watcher provided
- Do not default to one sector — adapt to the exposure in the objective
- DIVERSIFY: the hypotheses must cover genuinely different causal paths (demand, supply, regulatory, competitive, corporate). Never return variations of one story.
- Always include one bearish or invalidation path: what could move the ticker the other way, or prove the bull case wrong
- Never return the same set twice: if the question resembles a previous watch, find a fresh angle rather than repeating familiar buckets`;

function coerceHypotheses(list: unknown[]): DemandHypothesis[] {
  return list.slice(0, 5).map((raw, i) => {
    const h = (raw ?? {}) as Partial<DemandHypothesis>;
    return {
      id: `H-${i + 1}`,
      label: String(h.label ?? `Hypothesis ${i + 1}`).slice(0, 60),
      demandType: String(h.demandType ?? "").slice(0, 200),
      entityTypes: (Array.isArray(h.entityTypes) ? h.entityTypes : []).map((s) => String(s).slice(0, 60)).slice(0, 4),
      signals: (Array.isArray(h.signals) ? h.signals : []).map((s) => String(s).slice(0, 80)).slice(0, 5),
      searchHints: (Array.isArray(h.searchHints) ? h.searchHints : []).map((s) => String(s).slice(0, 80)).slice(0, 3),
      whatToVerify: (Array.isArray(h.whatToVerify) ? h.whatToVerify : []).map((s) => String(s).slice(0, 80)).slice(0, 5),
    };
  });
}

/** Salvage complete hypothesis objects from fenced or truncated output. */
function salvageHypotheses(text: string): DemandHypothesis[] {
  const found: unknown[] = [];
  let depth = 0;
  let start = -1;
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
      if (depth === 0) start = i;
      depth++;
      continue;
    }
    if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          const obj = JSON.parse(text.slice(start, i + 1)) as { label?: unknown };
          if (typeof obj.label === "string" && obj.label.trim()) found.push(obj);
        } catch {
          // incomplete object — skip it, keep the complete ones
        }
        start = -1;
      }
      if (depth < 0) depth = 0;
    }
  }
  return coerceHypotheses(found);
}

export async function generateHypotheses(
  question: string,
  observation?: string,
): Promise<DemandHypothesis[]> {
  const providers = jsonProviders();
  if (providers.length === 0) return deterministicHypotheses(question);
  let lastError = "unknown";
  const system = await guidedSystem(SYSTEM);
  const user = observation?.trim()
    ? `Objective: ${question.slice(0, 600)}\n\nOBSERVED BEFORE HYPOTHESIZING (ground every hypothesis in this, never invent events):\n${observation.slice(0, 3000)}`
    : `Objective: ${question.slice(0, 600)}\n\nNo observation was captured before this call. Hypothesize from the question text alone and keep each hypothesis testable rather than asserting facts.`;
  // One attempt per provider at 45s. Hypotheses shape the run, but the old
  // double-attempt loop (2 x 90s per provider) could stall wave-two dispatch
  // for minutes, and the deterministic fallback still produces a usable hunt.
  for (const { fn, name } of providers) {
    for (let attempt = 0; attempt < 1; attempt++) {
      try {
        const { content } = await fn({
          system,
          user,
          maxTokens: 4000,
          temperature: attempt === 0 ? 0.4 : 0.6,
          timeoutMs: 45_000,
        });
        const start = content.indexOf("{");
        const end = content.lastIndexOf("}");
        const parsed = JSON.parse(content.slice(start, end + 1)) as { hypotheses?: unknown[] };
        const list = parsed?.hypotheses;
        if (Array.isArray(list) && list.length >= 2) return coerceHypotheses(list);
        const salvaged = salvageHypotheses(content);
        if (salvaged.length >= 2) return salvaged;
        lastError = `${name}: only ${Array.isArray(list) ? list.length : 0} hypotheses parsed`;
      } catch (error) {
        lastError = `${name}: ${error instanceof Error ? error.message.slice(0, 140) : "call failed"}`;
        const raw = (error as { rawContent?: string }).rawContent;
        if (raw) {
          const salvaged = salvageHypotheses(raw);
          if (salvaged.length >= 2) return salvaged;
        }
      }
    }
  }
  console.error("hypotheses degraded to open fallback:", lastError);
  return deterministicHypotheses(question);
}
