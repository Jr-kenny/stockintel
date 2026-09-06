import { ArrowUpRight } from "lucide-react";
import type { Chain, EvidenceItem, IntelligenceReport } from "@/lib/orchestrator/report";
import { StatusPill } from "./AppUI";

/**
 * The intelligence report, rendered.
 *
 * Reading order is the whole point: the assessment comes first, then the
 * evidence that supports it, then the connections between events, then what it
 * means over time, then what would prove it wrong. A reader should never have
 * to work through fifteen sources to find out why they matter.
 *
 * Every factual claim carries its evidence id, so a chain hop or a horizon can
 * be traced back to the event and the source behind it.
 */

const bandTone = {
  high: "verified",
  moderate: "tracking",
  low: "flagged",
} as const;

const pricedInLabel: Record<string, string> = {
  underpriced: "Not yet in the price",
  priced: "Already in the price",
  overpriced: "Price ahead of the evidence",
  unclear: "Too mixed to call",
};

/** Evidence ids as small monospace chips, so a claim is traceable at a glance. */
function Cites({ ids }: { ids: string[] }) {
  if (ids.length === 0) return null;
  return (
    <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
      {ids.map((id) => (
        <span
          key={id}
          className="rounded-sm border border-border px-1 font-mono text-[10px] leading-4 text-muted-foreground"
        >
          {id}
        </span>
      ))}
    </span>
  );
}

function basisTone(basis: Chain["hops"][number]["basis"]): string {
  // Speculative hops are dimmed on purpose. A reader should be able to see how
  // much of a chain is known versus reasoned without reading the labels.
  if (basis === "observed") return "text-signal";
  if (basis === "inferred") return "text-foreground";
  return "text-muted-foreground italic";
}

function ChainCard({ chain }: { chain: Chain }) {
  const dirLabel =
    chain.direction === "up"
      ? "points up"
      : chain.direction === "down"
        ? "points down"
        : chain.direction === "mixed"
          ? "cuts both ways"
          : "neutral";
  return (
    <li className="surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="label-mono text-signal">
          {dirLabel} · {chain.magnitude}
        </p>
      </div>
      <p className="mt-2 text-sm font-medium leading-relaxed">{chain.claim}</p>
      <ol className="mt-3 space-y-1.5">
        {chain.hops.map((hop, i) => (
          <li key={`${hop.from}-${hop.to}-${i}`} className="font-mono text-xs leading-relaxed">
            <span className={basisTone(hop.basis)}>
              {hop.from} <span className="text-muted-foreground">—{hop.relation}→</span> {hop.to}
            </span>
            <span className="ml-2 text-[10px] uppercase text-muted-foreground">{hop.basis}</span>
            <Cites ids={hop.evidenceIds} />
          </li>
        ))}
      </ol>
      <p className="mt-3 border-l-2 border-border pl-3 text-sm leading-relaxed text-muted-foreground">
        {chain.soWhat}
      </p>
    </li>
  );
}

function EvidenceCard({ item }: { item: EvidenceItem }) {
  return (
    <li className="surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="label-mono text-signal">
            {item.id} · {item.observed}
          </p>
          <h4 className="mt-1 font-display text-lg leading-tight">{item.entity}</h4>
        </div>
        <StatusPill
          tone={bandTone[item.confidence]}
          label={`${item.confidence} confidence`}
          compact
        />
      </div>
      <p className="mt-3 text-sm leading-relaxed">{item.whatHappened}</p>
      <p className="mt-3 text-sm leading-relaxed">
        <span className="label-mono text-signal">Why it matters · </span>
        {item.whyItMatters}
      </p>
      <p className="mt-2 text-sm leading-relaxed">
        <span className="label-mono text-signal">Our read · </span>
        {item.ourRead}
      </p>
      <p className="mt-2 font-mono text-xs text-muted-foreground">{item.confidenceReason}</p>
      {item.sources.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3">
          {item.sources.map((s, i) => (
            <li key={`${s.url}-${i}`}>
              <a
                href={s.url}
                target="_blank"
                rel="noreferrer"
                title={s.url}
                className="inline-flex max-w-[240px] items-center gap-1.5 rounded-sm border border-border px-2.5 py-1.5 font-mono text-xs text-signal hover:border-signal hover:bg-slate/30"
              >
                <span className="truncate">{s.label || s.url}</span>
                <span className="shrink-0 text-[10px] uppercase text-muted-foreground">
                  {s.tier}
                </span>
                <ArrowUpRight className="size-3 shrink-0" aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function ReportView({
  report,
  marketSlot,
}: {
  report: IntelligenceReport;
  /** Agent OS connect control, rendered inside the market section. */
  marketSlot?: React.ReactNode;
}) {
  const r = report;
  const horizons = [
    r.implication.immediate,
    r.implication.weeks,
    r.implication.months,
    r.implication.year,
  ];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
      {/* 1 — Executive. Conclusion before evidence, always. */}
      <section className="surface-dark p-6 sm:p-8" aria-label="Executive intelligence">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="label-mono text-signal">
            Intelligence report · {r.ticker} · {r.period}
          </p>
          <StatusPill
            tone={bandTone[r.confidence.band]}
            label={`${r.confidence.band} confidence`}
          />
        </div>
        <h3 className="mt-4 font-display text-2xl leading-tight sm:text-3xl">
          {r.executive.assessment}
        </h3>
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-ink-muted">
          {r.executive.whatHappened}
        </p>
        <p className="mt-3 max-w-3xl border-l-2 border-signal pl-4 text-sm leading-relaxed">
          {r.executive.whyItMatters}
        </p>
        <p className="mt-4 font-mono text-xs text-muted-foreground">
          Confidence: {r.confidence.reason}
        </p>
      </section>

      {/* 2 — Synthesis before evidence: the connections are the product. */}
      {(r.synthesis.chains.length > 0 || r.synthesis.notObvious) && (
        <section aria-label="Cross-source synthesis">
          <p className="label-mono text-signal">Connecting the events</p>
          <h3 className="mt-2 font-display text-xl">What the evidence says together</h3>
          {r.synthesis.chains.length > 0 ? (
            <ol className="mt-4 space-y-4">
              {r.synthesis.chains.map((c, i) => (
                <ChainCard key={`${c.claim}-${i}`} chain={c} />
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              No causal chains were traced on this run. The events below stand alone.
            </p>
          )}
          {r.synthesis.notObvious && (
            <p className="mt-4 max-w-3xl border-l-2 border-signal pl-4 text-sm leading-relaxed">
              <span className="label-mono text-signal">Not obvious · </span>
              {r.synthesis.notObvious}
            </p>
          )}
          {r.synthesis.whatChanged && (
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              <span className="label-mono text-signal">What changed · </span>
              {r.synthesis.whatChanged}
            </p>
          )}
          {r.synthesis.contradictions.length > 0 && (
            <ul className="mt-4 space-y-2">
              {r.synthesis.contradictions.map((c, i) => (
                <li
                  key={i}
                  className="rounded-sm border border-border bg-slate/20 p-3 text-sm leading-relaxed"
                >
                  <span className="label-mono text-signal">Points the other way · </span>
                  {c}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* 3 — Market implication across horizons, with the measured priced-in call. */}
      <section className="surface-dark p-6 sm:p-8" aria-label="Market implication">
        <p className="label-mono text-signal">Market implication</p>
        <h3 className="mt-2 font-display text-xl">
          {pricedInLabel[r.implication.pricedIn] ?? r.implication.pricedIn}
        </h3>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-muted">
          {r.implication.pricedInReason}
        </p>
        {marketSlot && <div className="mt-3">{marketSlot}</div>}
        {r.implication.marketLines.length > 0 && (
          <ul className="mt-4 space-y-1.5 font-mono text-xs leading-relaxed text-ink-muted">
            {r.implication.marketLines.slice(0, 8).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        <dl className="mt-6 space-y-4 border-t border-border pt-5">
          {horizons.map((h) => (
            <div key={h.window}>
              <dt className="label-mono text-signal">
                {h.window}
                <Cites ids={h.evidenceIds} />
              </dt>
              <dd className="mt-1 text-sm leading-relaxed text-ink-muted">{h.assessment}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* 4 — Scenarios. Falsifiable or it is not an assessment. */}
      {(r.scenarios.cases.length > 0 || r.scenarios.invalidation.length > 0) && (
        <section aria-label="Scenarios">
          <p className="label-mono text-signal">Scenarios</p>
          <h3 className="mt-2 font-display text-xl">How this could play out</h3>
          {r.scenarios.cases.length > 0 && (
            <ul className="mt-4 grid gap-4 sm:grid-cols-3">
              {r.scenarios.cases.map((c) => (
                <li key={c.case} className="surface p-5">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="label-mono text-signal">{c.case}</p>
                    <p className="font-mono text-2xl text-signal">{c.probability}%</p>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed">{c.narrative}</p>
                  {c.requires.length > 0 && (
                    <ul className="mt-3 space-y-1 border-t border-border pt-3">
                      {c.requires.map((req, i) => (
                        <li
                          key={i}
                          className="font-mono text-xs leading-relaxed text-muted-foreground"
                        >
                          needs: {req}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            {r.scenarios.catalysts.length > 0 && (
              <div>
                <p className="label-mono text-signal">Catalysts</p>
                <ul className="mt-2 space-y-1.5">
                  {r.scenarios.catalysts.map((c, i) => (
                    <li key={i} className="text-sm leading-relaxed text-muted-foreground">
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {r.scenarios.risks.length > 0 && (
              <div>
                <p className="label-mono text-signal">Risks</p>
                <ul className="mt-2 space-y-1.5">
                  {r.scenarios.risks.map((c, i) => (
                    <li key={i} className="text-sm leading-relaxed text-muted-foreground">
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {r.scenarios.invalidation.length > 0 && (
            <div className="mt-5 rounded-sm border border-border bg-slate/20 p-5">
              <p className="label-mono text-signal">What would break this assessment</p>
              <ul className="mt-2 space-y-1.5">
                {r.scenarios.invalidation.map((inv, i) => (
                  <li key={i} className="text-sm leading-relaxed">
                    {inv}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* 5 — Evidence. Proof, after the reader knows why it matters. */}
      {r.evidence.length > 0 && (
        <section aria-label="Evidence">
          <p className="label-mono text-signal">Evidence · {r.evidence.length}</p>
          <h3 className="mt-2 font-display text-xl">
            What actually happened, and where it came from
          </h3>
          <ol className="mt-4 space-y-4">
            {r.evidence.map((e) => (
              <EvidenceCard key={e.id} item={e} />
            ))}
          </ol>
        </section>
      )}

      {/* 6 — Bottom line. Compress it again. */}
      <section className="surface-dark p-6 sm:p-8" aria-label="Bottom line">
        <p className="label-mono text-signal">Bottom line</p>
        <p className="mt-3 max-w-3xl font-display text-xl leading-snug">{r.bottomLine.remember}</p>
        <div className="mt-5 grid gap-4 border-t border-border pt-5 sm:grid-cols-2">
          <div>
            <p className="label-mono text-signal">Watch next</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-muted">{r.bottomLine.monitor}</p>
          </div>
          <div>
            <p className="label-mono text-signal">Reconsider if</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-muted">
              {r.bottomLine.reconsiderIf}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
