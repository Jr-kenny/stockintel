/**
 * The connection pass — where evidence becomes intelligence.
 *
 * This is the step that was missing. Synthesis received four truncated rows and
 * was asked for a four-sentence body, so "connect the dots" never happened:
 * connections were either a keyword switch (exposurePath) or a hardcoded 3xN
 * loop (deriveFollowUpTasks). Neither reasons about what the evidence means
 * together.
 *
 * This pass sees the FULL graded evidence set and produces named causal chains:
 * A supplies B, B is building C, therefore the watched name's exposure moves.
 * Each hop is labeled observed, inferred or speculative, and carries the
 * evidence ids behind it, so the report can be checked rather than trusted.
 *
 * It runs before synthesis and its output is what synthesis writes from.
 */

import { jsonProviders } from "@/lib/llm/providers";
import { guidedSystem } from "./soul";
import type { GradedClaim } from "./grade";
import { confidenceBand, judgeQuality } from "./source-quality";
import type { Chain, EvidenceItem } from "./report";
import { chainSchema, evidenceItemSchema } from "./report";
import { z } from "zod";

/** What the connection pass returns to synthesis. */
export type ConnectionResult = {
  evidence: EvidenceItem[];
  chains: Chain[];
  notObvious: string;
  contradictions: string[];
  /** "llm" when a model reasoned, "deterministic" when it fell back. */
  mode: "llm" | "deterministic";
};

const responseSchema = z.object({
  evidence: z.array(evidenceItemSchema),
  chains: z.array(chainSchema),
  notObvious: z.string(),
  contradictions: z.array(z.string()).default([]),
});

/**
 * Contract kept tight and key names repeated: small models invent their own
 * shape when the instruction is long, and this schema is deep enough that one
 * renamed key loses the whole pass.
 */
const CONTRACT = `Return ONLY one JSON object with EXACTLY these top-level keys: evidence, chains, notObvious, contradictions. No markdown, no prose.

evidence: array, one object per input event you judge relevant, EXACTLY these keys:
  id (reuse the input id, E1/E2/...), headline, entity, observed,
  whatHappened (summarise the reporting, invent nothing),
  whyItMatters (what it means for the watched name's business, supply chain, competitors or pricing power),
  ourRead (your position on it),
  confidence ("high"|"moderate"|"low"), confidenceReason, sources (array of {label,url,tier}).
  Drop input events that are not real events (publisher homepages, section fronts, listicles).

chains: array of 1-4 objects, EXACTLY these keys: claim, hops, direction, magnitude, soWhat.
  This is the point of the whole exercise. Do NOT restate single events.
  Each chain joins TWO OR MORE events into something no single event says.
  hops: array of {from, relation, to, basis, evidenceIds}.
    relation is a real named relationship: "supplies", "competes with", "is a customer of",
    "is building", "depends on", "displaces", "constrains", "funds".
    basis is "observed" (stated in the evidence), "inferred" (follows from it) or
    "speculative" (plausible, unproven). observed and inferred REQUIRE evidenceIds.
  direction is "up"|"down"|"mixed"|"neutral" for the watched name.
  magnitude is "material"|"moderate"|"marginal".
  soWhat: why this chain changes the picture. Include capacity and constraint reasoning
  where it applies: who wants to build, who lacks the capacity to do it alone, who they
  likely partner with or fall back to, and why.

notObvious: what a reader misses reading these events one at a time. One paragraph.
contradictions: array of strings naming evidence that points the other way. Empty array if none.

Example chain: {"claim":"Hyperscaler in-house silicon is moving from pilot to volume","hops":[{"from":"Amazon","relation":"is building","to":"Trainium 3 at scale","basis":"observed","evidenceIds":["E2"]},{"from":"Trainium 3","relation":"displaces","to":"merchant GPU purchases","basis":"inferred","evidenceIds":["E2","E4"]}],"direction":"down","magnitude":"material","soWhat":"..."}`;

function parseJsonLoose(raw: string): unknown {
  const text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("no JSON object in response");
    return JSON.parse(text.slice(start, end + 1));
  }
}

/**
 * Build the model's input. Unlike synthesis this does NOT truncate to four
 * items: the whole point is seeing everything at once, because a connection
 * between event 2 and event 9 is invisible if event 9 was sliced off.
 */
function buildInput(
  question: string,
  graded: GradedClaim[],
  marketBlock: string,
  priorSummary: string | null,
): { user: string; index: Map<string, GradedClaim> } {
  const index = new Map<string, GradedClaim>();
  const rows = graded.slice(0, 24).map((g, i) => {
    const id = `E${i + 1}`;
    index.set(id, g);
    const j = judgeQuality(g.evidence);
    return {
      id,
      entity: g.company.slice(0, 60),
      headline: (g.evidence[0]?.item ?? g.claim).slice(0, 200),
      observed: g.evidence[0]?.observed ?? "",
      source_tier: g.sourceTier ?? j.bestTier,
      independent_publishers: g.independentPublishers ?? j.independentPublishers,
      confidence: confidenceBand(j),
      confidence_reason: g.qualityReason ?? j.reason,
      sources: g.evidence.slice(0, 3).map((e) => ({
        label: e.source.replace(/^https?:\/\//, "").split("/")[0] ?? e.source,
        url: e.source,
        tier: j.bestTier,
      })),
    };
  });

  const parts = [
    `WATCHING: ${question.slice(0, 300)}`,
    `EVENTS (${rows.length}):`,
    ...rows.map((r) => JSON.stringify(r)),
  ];
  if (marketBlock.trim()) parts.push(`MARKET CONTEXT:\n${marketBlock.slice(0, 900)}`);
  if (priorSummary) parts.push(`PRIOR ASSESSMENT (for what changed):\n${priorSummary.slice(0, 600)}`);
  parts.push(
    "Connect these events. Chains that join two or more events are the deliverable; single-event restatements are not.",
  );

  return { user: parts.join("\n"), index };
}

/**
 * Deterministic fallback. Cannot invent causality, so it does not pretend to:
 * it groups events by shared entity, states the co-occurrence plainly, and
 * labels every hop it emits as inferred with the evidence attached.
 *
 * An honest thin chain beats a confident fabricated one.
 */
function deterministicConnections(
  graded: GradedClaim[],
  index: Map<string, GradedClaim>,
): ConnectionResult {
  const evidence: EvidenceItem[] = [];
  for (const [id, g] of index) {
    const j = judgeQuality(g.evidence);
    const headline = g.evidence[0]?.item ?? g.claim;
    evidence.push({
      id,
      headline: headline.slice(0, 200),
      entity: g.company,
      observed: g.evidence[0]?.observed ?? "",
      whatHappened: headline.slice(0, 300),
      whyItMatters: "Impact path not traced: the connection pass was unavailable for this run.",
      ourRead: "Recorded as raw evidence only. No interpretation was produced.",
      confidence: confidenceBand(j),
      confidenceReason: g.qualityReason ?? j.reason,
      sources: g.evidence.slice(0, 3).map((e) => ({
        label: e.source.replace(/^https?:\/\//, "").split("/")[0] ?? e.source,
        url: e.source,
        tier: g.sourceTier ?? j.bestTier,
      })),
    });
  }

  // Co-occurrence is the only connection available without reasoning: two
  // events naming the same entity within the window.
  const byEntity = new Map<string, string[]>();
  for (const e of evidence) {
    const key = e.entity.toLowerCase();
    byEntity.set(key, [...(byEntity.get(key) ?? []), e.id]);
  }
  const chains: Chain[] = [];
  for (const [entity, ids] of byEntity) {
    if (ids.length < 2 || chains.length >= 3) continue;
    const name = evidence.find((e) => e.entity.toLowerCase() === entity)?.entity ?? entity;
    chains.push({
      claim: `Multiple independent events cluster on ${name} inside the same window`,
      hops: [
        {
          from: name,
          relation: "appears repeatedly in",
          to: "this window's evidence",
          basis: "inferred",
          evidenceIds: ids.slice(0, 4),
        },
      ],
      direction: "neutral",
      magnitude: "marginal",
      soWhat:
        "Clustering says attention, not causation. The causal path was not traced on this run, so treat it as a lead to investigate rather than a finding.",
    });
  }

  return {
    evidence,
    chains,
    notObvious:
      "No cross-source reasoning ran for this report. The events below stand alone and have not been connected.",
    contradictions: [],
    mode: "deterministic",
  };
}

/** Reject hops that claim to be grounded while citing nothing real. */
function pruneChains(chains: Chain[], knownIds: Set<string>): Chain[] {
  const out: Chain[] = [];
  for (const c of chains) {
    const hops = c.hops
      .map((h) => ({ ...h, evidenceIds: h.evidenceIds.filter((id) => knownIds.has(id)) }))
      .filter((h) => h.basis === "speculative" || h.evidenceIds.length > 0);
    if (hops.length === 0) continue;
    // A chain that touches one event is a restatement, not a connection.
    const touched = new Set(hops.flatMap((h) => h.evidenceIds));
    if (touched.size < 2 && !hops.some((h) => h.basis === "speculative")) continue;
    out.push({ ...c, hops });
  }
  return out;
}

export async function connectEvidence(params: {
  question: string;
  graded: GradedClaim[];
  marketBlock: string;
  priorSummary?: string | null;
}): Promise<ConnectionResult> {
  const { question, graded, marketBlock } = params;
  if (graded.length === 0) {
    return {
      evidence: [],
      chains: [],
      notObvious: "No evidence was collected, so nothing could be connected.",
      contradictions: [],
      mode: "deterministic",
    };
  }

  const { user, index } = buildInput(question, graded, marketBlock, params.priorSummary ?? null);
  const system = await guidedSystem(CONTRACT);
  const knownIds = new Set(index.keys());

  for (const { fn, name } of jsonProviders()) {
    // Single temperature per provider. The old t=0.3 then t=0.6 retry doubled
    // worst-case latency (6 x 180s) and the second attempt rarely saved a run
    // the first could not parse. Fail fast to the next provider instead.
    for (const temperature of [0.3]) {
      try {
        const res = await fn({
          // Same truncation trap as the report pass: the chains carry per-hop
          // evidence ids, so a cut-off response loses the ids and reads as
          // "no recognised evidence ids" rather than as an incomplete answer.
          maxTokens: 10_000,
          system,
          user,
          temperature,
          timeoutMs: 90_000,
        });
        const parsed = responseSchema.parse(parseJsonLoose(res.content));
        const evidence = parsed.evidence.filter((e) => knownIds.has(e.id));
        const chains = pruneChains(parsed.chains, knownIds);
        if (evidence.length === 0) throw new Error("no recognised evidence ids");
        console.log(
          `[connect] ${name} t=${temperature}: ${evidence.length} events, ${chains.length} chain(s)`,
        );
        return {
          evidence,
          chains,
          notObvious: parsed.notObvious,
          contradictions: parsed.contradictions,
          mode: "llm",
        };
      } catch (err) {
        console.warn(
          `[connect] ${name} t=${temperature} failed:`,
          err instanceof Error ? err.message.slice(0, 160) : err,
        );
      }
    }
  }

  console.warn("[connect] all providers failed, falling back to co-occurrence only");
  return deterministicConnections(graded, index);
}
