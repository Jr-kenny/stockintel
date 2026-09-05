/**
 * Grading engine — turns raw agent claims into weighted, clustered intelligence.
 *
 * Principles implemented here (locked in the product spec):
 *  - Duplicate citations collapse into one source cluster; five agents citing
 *    one article count as ONE source.
 *  - Tiers: discovery (new clusters) > confirmation (corroborates without new
 *    clusters) > duplication (everything already seen from same sources).
 *  - Weight = relevance × quality × independence × reliability × impact.
 */

export type SubmittedEvidence = { item: string; source: string; observed: string };

export type SubmittedClaim = {
  company: string;
  claim: string;
  confidence: number;
  evidence: SubmittedEvidence[];
  whyRelevant?: string | null;
  contact?: string | null;
};

export type GradedClaim = SubmittedClaim & {
  tier: "discovery" | "confirmation" | "duplication";
  weight: number;
  dims: {
    relevance: number;
    quality: number;
    independence: number;
    reliability: number;
    impact: number;
  };
};

export function sourceClusterKey(source: string): string {
  const raw = source.trim();
  // Try URL-aware canonicalization: keep meaningful query (e.g. tender?id=123), strip tracking.
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    let path = u.pathname.replace(/\/+$/, "") || "/";
    // Strip tracking params, keep business-relevant ones
    const tracking = new Set([
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "utm_id",
      "fbclid",
      "gclid",
      "msclkid",
      "igshid",
      "mc_cid",
      "mc_eid",
      "_hsenc",
      "_hsmi",
      "yclid",
    ]);
    const kept: [string, string][] = [];
    u.searchParams.forEach((v, k) => {
      if (!tracking.has(k.toLowerCase()) && !k.toLowerCase().startsWith("utm_")) kept.push([k, v]);
    });
    kept.sort(([a], [b]) => a.localeCompare(b));
    const query = kept.length ? `?${kept.map(([k, v]) => `${k}=${v}`).join("&")}` : "";
    return `${host}${path}${query}`.toLowerCase();
  } catch {
    return raw
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "");
  }
}

type AgentInfo = { id: string; reliability: number };

export type GradeInput = {
  claims: (SubmittedClaim & { agentId: string })[];
  agents: Record<string, AgentInfo>;
};

export type GradeOutput = {
  graded: (GradedClaim & { agentId: string })[];
  totalClusters: number;
};

export function gradeClaims({ claims, agents }: GradeInput): GradeOutput {
  // Pass 1 — cluster every cited source across the whole inquiry window.
  const clusters = new Map<string, Set<string>>(); // key -> agentIds that cited it
  for (const c of claims) {
    for (const ev of c.evidence) {
      const key = sourceClusterKey(ev.source);
      if (!clusters.has(key)) clusters.set(key, new Set());
      clusters.get(key)!.add(c.agentId);
    }
  }

  const totalClusters = clusters.size;
  let newClustersSeen = 0;

  // Pass 2 — grade each claim against what earlier submissions revealed.
  const graded = claims.map((c) => {
    const keys = c.evidence.map((ev) => sourceClusterKey(ev.source));
    const uniqueKeys = Array.from(new Set(keys));
    const freshKeys = uniqueKeys.filter((key) => {
      const citers = clusters.get(key);
      // "fresh" = this agent is the first (or only) contributor of this source
      return citers ? citers.size >= 1 && !seenByOthers(key, c.agentId, clusters) : false;
    });

    const totalCitations = Math.max(keys.length, 1);
    const independence = uniqueKeys.length / totalCitations;
    const hasNewSource =
      freshKeys.length > 0 || uniqueKeys.some((k) => (clusters.get(k)?.size ?? 0) === 1);

    let tier: GradedClaim["tier"];
    if (hasNewSource) tier = "discovery";
    else if (uniqueKeys.length > 0) tier = "confirmation";
    else tier = "duplication";

    const quality = clamp01(c.confidence);
    // Relevance: the grid never pre-filters, so an agent responding at all IS
    // its own relevance judgment. The LLM pass in ./llm-grade refines this
    // later; misjudged responses erode the agent's reliability instead.
    const relevance = 1;
    const reliability = clamp01(agents[c.agentId]?.reliability ?? 0.8);
    const impact = clamp01(
      totalClusters > 0 ? (hasNewSource ? freshKeys.length + 1 : 0.5) / totalClusters : 0,
    );

    // No punishment multiplier: duplicates did their work correctly — three
    // people answering identically searched the same place, they are not
    // wrong. Tiers describe the contribution shape (for clustering language
    // and internal routing); the natural dampening comes from independence
    // and impact, so same-source repeats earn less WITHOUT being penalised.
    const weight = relevance * quality * independence * reliability * impact;

    if (tier === "discovery") newClustersSeen += freshKeys.length;

    return {
      ...c,
      tier,
      dims: {
        relevance,
        quality: round2(quality),
        independence: round2(independence),
        reliability: round2(reliability),
        impact: round2(impact),
      },
      weight: round4(weight),
    };
  });

  void newClustersSeen;
  return { graded, totalClusters };
}

function seenByOthers(key: string, agentId: string, clusters: Map<string, Set<string>>): boolean {
  const citers = clusters.get(key);
  if (!citers) return false;
  for (const id of citers) if (id !== agentId) return true;
  return false;
}

export function clamp01(n: number) {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}
export function round2(n: number) {
  return Math.round(n * 100) / 100;
}
export function round4(n: number) {
  return Math.round(n * 10000) / 10000;
}
