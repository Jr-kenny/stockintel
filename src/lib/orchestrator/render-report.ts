/**
 * Render an intelligence report as text for agent callers.
 *
 * MCP tools return `structuredContent` for machines and `text` for whatever is
 * reading along. This owns the text form so the report reads as a report,
 * conclusion first, rather than as a flattened list of verdicts.
 *
 * Order matters: executive, then evidence, then the connections, then horizons,
 * then scenarios, then bottom line. The reader should know why the evidence
 * matters before seeing any of it.
 */

import type { Chain, IntelligenceReport } from "./report";

function chainText(c: Chain): string {
  const path = c.hops
    .map((h) => {
      const cite = h.evidenceIds.length > 0 ? ` [${h.evidenceIds.join(",")}]` : "";
      return `${h.from} --${h.relation}--> ${h.to} (${h.basis}${cite})`;
    })
    .join("\n     ");
  return `  ${c.claim} [${c.direction}, ${c.magnitude}]\n     ${path}\n     So what: ${c.soWhat}`;
}

export function renderReport(report: IntelligenceReport, opts?: { note?: string }): string {
  const r = report;
  const out: string[] = [];

  if (opts?.note) out.push(opts.note, "");

  out.push(`INTELLIGENCE REPORT — ${r.ticker} · ${r.period}`, "");

  out.push("EXECUTIVE");
  out.push(`  What happened: ${r.executive.whatHappened}`);
  out.push(`  Why it matters: ${r.executive.whyItMatters}`);
  out.push(`  Our assessment: ${r.executive.assessment}`);
  out.push(`  Confidence: ${r.confidence.band} — ${r.confidence.reason}`, "");

  if (r.evidence.length > 0) {
    out.push(`EVIDENCE (${r.evidence.length})`);
    for (const e of r.evidence) {
      out.push(`  ${e.id} · ${e.entity} · ${e.observed} · ${e.confidence}`);
      out.push(`     ${e.whatHappened}`);
      out.push(`     Why it matters: ${e.whyItMatters}`);
      out.push(`     Our read: ${e.ourRead}`);
      out.push(`     Confidence: ${e.confidenceReason}`);
      for (const s of e.sources) out.push(`     Source (${s.tier}): ${s.label} ${s.url}`);
    }
    out.push("");
  }

  out.push("SYNTHESIS");
  if (r.synthesis.chains.length > 0) {
    for (const c of r.synthesis.chains) out.push(chainText(c));
  } else {
    out.push("  No causal chains were traced for this run.");
  }
  if (r.synthesis.notObvious) out.push(`  Not obvious: ${r.synthesis.notObvious}`);
  if (r.synthesis.whatChanged) out.push(`  What changed: ${r.synthesis.whatChanged}`);
  for (const c of r.synthesis.contradictions) out.push(`  Contradiction: ${c}`);
  out.push("");

  out.push("MARKET IMPLICATION");
  for (const line of r.implication.marketLines) out.push(`  ${line}`);
  out.push(`  Priced in: ${r.implication.pricedIn} — ${r.implication.pricedInReason}`);
  for (const h of [
    r.implication.immediate,
    r.implication.weeks,
    r.implication.months,
    r.implication.year,
  ]) {
    const cite = h.evidenceIds.length > 0 ? ` [${h.evidenceIds.join(",")}]` : "";
    out.push(`  ${h.window}: ${h.assessment}${cite}`);
  }
  out.push("");

  out.push("SCENARIOS");
  for (const c of r.scenarios.cases) {
    out.push(`  ${c.case} (${c.probability}%): ${c.narrative}`);
    for (const req of c.requires) out.push(`     requires: ${req}`);
  }
  for (const c of r.scenarios.catalysts) out.push(`  Catalyst: ${c}`);
  for (const risk of r.scenarios.risks) out.push(`  Risk: ${risk}`);
  for (const inv of r.scenarios.invalidation) out.push(`  Invalidation: ${inv}`);
  out.push("");

  out.push("BOTTOM LINE");
  out.push(`  ${r.bottomLine.remember}`);
  out.push(`  Monitor: ${r.bottomLine.monitor}`);
  out.push(`  Reconsider if: ${r.bottomLine.reconsiderIf}`);

  return out.join("\n");
}

/** Short form for status lines and change summaries. */
export function reportHeadline(report: IntelligenceReport): string {
  return `${report.ticker}: ${report.implication.pricedIn}, ${report.confidence.band} confidence. ${report.bottomLine.remember}`;
}
