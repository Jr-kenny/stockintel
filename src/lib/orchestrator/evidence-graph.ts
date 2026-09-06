import { db, nowIso, newId } from "@/lib/db";
import { graphNodes, graphEdges } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { GradedClaim } from "./grade";
import type { Chain } from "./report";

export type GraphBuildResult = {
  nodes: { id: string; type: string; label: string }[];
  edges: { from: string; to: string; relation: string; basis?: string; claim?: string }[];
};

const BASIS_CONFIDENCE: Record<string, number> = {
  observed: 0.85,
  inferred: 0.6,
  speculative: 0.35,
};

/**
 * Minimal evidence graph builder — distilled from Yash evidence/graph.py
 * and shandu citation ledger ideas, but business-focused.
 * Creates: company nodes, project mentions as nodes, and edges to sources.
 * Facts vs inference is kept as edge metadata (relation) not as a separate label table.
 */
export async function buildEvidenceGraph(inquiryId: string, graded: GradedClaim[]): Promise<GraphBuildResult> {
  const nodes: GraphBuildResult["nodes"] = [];
  const edges: GraphBuildResult["edges"] = [];
  const nodeByLabel = new Map<string, string>();
  try {
    await db.delete(graphEdges).where(eq(graphEdges.inquiryId, inquiryId));
    await db.delete(graphNodes).where(eq(graphNodes.inquiryId, inquiryId));
  } catch {}

  function ensureNode(label: string, type: string, source?: string): string {
    const key = `${type}:${label.toLowerCase()}`;
    if (nodeByLabel.has(key)) return nodeByLabel.get(key)!;
    const id = newId("NODE");
    nodeByLabel.set(key, id);
    nodes.push({ id, type, label });
    void db
      .insert(graphNodes)
      .values({ id, inquiryId, type, label, source: source ?? null, createdAt: nowIso() })
      .catch(() => undefined);
    return id;
  }

  for (const g of graded) {
    const companyId = ensureNode(g.company, "company", g.evidence[0]?.source);
    for (const ev of g.evidence) {
      const sourceId = ensureNode(ev.source.slice(0, 80), "source", ev.source);
      const edgeId = newId("EDGE");
      edges.push({ from: companyId, to: sourceId, relation: "announced_in" });
      void db
        .insert(graphEdges)
        .values({
          id: edgeId,
          inquiryId,
          fromId: companyId,
          toId: sourceId,
          relation: "announced_in",
          claim: ev.item.slice(0, 280),
          confidence: g.weight,
          source: ev.source,
          createdAt: nowIso(),
        })
        .catch(() => undefined);

      // Simple project extraction: if evidence mentions hotel/project/estate, add project node
      const projMatch = ev.item.match(/\b(\d+)[\s-]*(room|bed|unit|apartment)s?\b/i) ?? ev.item.match(/\b(hotel|estate|mall|hospital|project)\b/i);
      if (projMatch) {
        const projLabel = `${g.company} — ${projMatch[0]}`;
        const projId = ensureNode(projLabel, "project", ev.source);
        const peId = newId("EDGE");
        edges.push({ from: companyId, to: projId, relation: "owns" });
        void db
          .insert(graphEdges)
          .values({
            id: peId,
            inquiryId,
            fromId: companyId,
            toId: projId,
            relation: "owns",
            claim: g.claim.slice(0, 280),
            confidence: g.weight,
            source: ev.source,
            createdAt: nowIso(),
          })
          .catch(() => undefined);
      }
    }

    // Inference edge: company -> needs -> demand (not a fact, probable inference)
    if (g.whyRelevant) {
      const demandLabel = g.whyRelevant.slice(0, 80);
      const demandId = ensureNode(demandLabel, "demand");
      const infId = newId("EDGE");
      edges.push({ from: companyId, to: demandId, relation: "likely_needs" });
      void db
        .insert(graphEdges)
        .values({
          id: infId,
          inquiryId,
          fromId: companyId,
          toId: demandId,
          relation: "likely_needs",
          claim: g.whyRelevant.slice(0, 280),
          confidence: g.weight * 0.8,
          source: g.evidence[0]?.source ?? null,
          createdAt: nowIso(),
        })
        .catch(() => undefined);
    }
  }

  return { nodes, edges };
}

/**
 * Persist connection chains as traversable entity-to-entity edges. The base
 * graph only links companies to sources, so no A to B to C path can exist.
 * Chain hops are the missing layer: each hop becomes one edge between two
 * entity nodes, with basis encoded in the claim prefix and evidence ids in
 * the source field for traceability.
 */
export async function persistConnectionChains(
  inquiryId: string,
  chains: Chain[],
): Promise<GraphBuildResult> {
  const nodes: GraphBuildResult["nodes"] = [];
  const edges: GraphBuildResult["edges"] = [];
  const nodeByLabel = new Map<string, string>();

  const existing = await db.select().from(graphNodes).where(eq(graphNodes.inquiryId, inquiryId)).catch(() => []);
  for (const n of existing) nodeByLabel.set(`${n.type}:${n.label.toLowerCase()}`, n.id);

  function ensureEntity(label: string): string {
    const clean = label.trim().slice(0, 80) || "unknown entity";
    const key = `entity:${clean.toLowerCase()}`;
    const hit = nodeByLabel.get(key);
    if (hit) return hit;
    const id = newId("NODE");
    nodeByLabel.set(key, id);
    nodes.push({ id, type: "entity", label: clean });
    void db
      .insert(graphNodes)
      .values({ id, inquiryId, type: "entity", label: clean, source: "connection-pass", createdAt: nowIso() })
      .catch(() => undefined);
    return id;
  }

  for (const chain of chains.slice(0, 4)) {
    for (const hop of chain.hops.slice(0, 6)) {
      const fromId = ensureEntity(hop.from);
      const toId = ensureEntity(hop.to);
      const edgeId = newId("EDGE");
      const claim = `[${hop.basis}] ${chain.claim.slice(0, 160)} - ${hop.from.slice(0, 40)} ${hop.relation} ${hop.to.slice(0, 40)}. ${chain.soWhat.slice(0, 120)}`.slice(0, 280);
      edges.push({ from: fromId, to: toId, relation: hop.relation, basis: hop.basis, claim });
      void db
        .insert(graphEdges)
        .values({
          id: edgeId,
          inquiryId,
          fromId,
          toId,
          relation: hop.relation.slice(0, 80),
          claim,
          confidence: BASIS_CONFIDENCE[hop.basis] ?? 0.5,
          source: hop.evidenceIds.length > 0 ? `evidence:${hop.evidenceIds.join(",")}` : "connection-pass",
          createdAt: nowIso(),
        })
        .catch(() => undefined);
    }
  }
  return { nodes, edges };
}

/**
 * Read back the traversable layer: entity-to-entity edges plus their endpoint
 * labels, so callers can walk A to B to C without re-reading the report.
 */
export async function entityChainsForInquiry(inquiryId: string): Promise<
  { from: string; relation: string; to: string; basis: string; claim: string }[]
> {
  try {
    const [nodeRows, edgeRows] = await Promise.all([
      db.select().from(graphNodes).where(eq(graphNodes.inquiryId, inquiryId)),
      db.select().from(graphEdges).where(eq(graphEdges.inquiryId, inquiryId)),
    ]);
    const labelById = new Map(nodeRows.map((n) => [n.id, n.label]));
    const out: { from: string; relation: string; to: string; basis: string; claim: string }[] = [];
    for (const e of edgeRows) {
      if (e.relation === "announced_in" || e.relation === "owns" || e.relation === "likely_needs") continue;
      const from = labelById.get(e.fromId) ?? e.fromId;
      const to = labelById.get(e.toId) ?? e.toId;
      const claim = e.claim ?? "";
      const basis = claim.startsWith("[observed]") ? "observed" : claim.startsWith("[inferred]") ? "inferred" : claim.startsWith("[speculative]") ? "speculative" : "inferred";
      out.push({ from, relation: e.relation, to, basis, claim });
    }
    return out;
  } catch {
    return [];
  }
}

export function factsVsInference(graded: GradedClaim[], topCompany: string) {
  const list = graded.filter((g) => g.company === topCompany);
  const facts = list.flatMap((g) =>
    g.evidence.map((e) => ({ text: e.item, source: e.source, observed: e.observed })),
  );
  const inferences = list
    .map((g) => g.whyRelevant)
    .filter(Boolean)
    .map((w) => ({ text: w!, reason: "Inferred from the announced activity and the buyer's inventory — needs verification" }));
  return { facts: facts.slice(0, 4), inferences: inferences.slice(0, 2) };
}
