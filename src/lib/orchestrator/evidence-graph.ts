import { db, nowIso, newId } from "@/lib/db";
import { graphNodes, graphEdges } from "@/lib/db/schema";
import type { GradedClaim } from "./grade";

export type GraphBuildResult = {
  nodes: { id: string; type: string; label: string }[];
  edges: { from: string; to: string; relation: string }[];
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
