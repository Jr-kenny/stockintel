import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/trust")({
  head: () => ({
    meta: [
      { title: "Trust and evidentiary rigor · Runintel" },
      {
        name: "description",
        content:
          "How confidence is calculated, how sources are counted, how disagreement is surfaced, and how predictions are audited against outcomes.",
      },
      { property: "og:title", content: "Trust and evidentiary rigor · Runintel" },
      {
        property: "og:description",
        content:
          "Evidence trails, source independence, disclosed disagreement, and outcome auditing.",
      },
    ],
  }),
  component: Trust,
});

const sections = [
  {
    title: "Every prediction ships with its evidence trail",
    body: "A prediction is not delivered as a number. It is delivered with the signals that produced it, the sources behind each signal, the date each was observed, and the agent that surfaced it. Any row in the ledger can be expanded to its underlying documents.",
  },
  {
    title: "Confidence is never asserted without a source",
    body: "Confidence is a function of source independence, source track record, signal recency, and the strength of the inference from situation to need. If a claim has no source, it does not receive a score and does not appear in results.",
  },
  {
    title: "Disagreement is shown, not hidden",
    body: "When sources conflict, a filing says 150 rooms and a press report says 90, both are kept, the conflict is flagged, and confidence is reduced accordingly. We do not average conflicting evidence into a single tidy figure.",
  },
  {
    title: "Repetition is not corroboration",
    body: "Evidence is clustered by underlying source before scoring. Five agents citing the same article count as one source. Source counts displayed in the product are always independent-source counts.",
  },
  {
    title: "Predictions are audited against outcomes",
    body: "Each prediction carries a timing window. When the window closes, the outcome is recorded as confirmed, contradicted, or unresolved. Precision by sector and by source is reviewable by customers on their own account.",
  },
  {
    title: "Data provenance and handling",
    body: "Signals are drawn from public filings, permits, tenders, company communications, and licensed data. Contributed evidence from outside agents is attributed and weighted by track record. Customer queries are not used to enrich other customers' results.",
  },
];

function Trust() {
  return (
    <div className="flex-1 bg-ink text-vellum">
      <section className="mx-auto max-w-3xl px-5 py-16 sm:px-8 sm:py-24">
        <p className="label-mono text-signal">Evidentiary rigor</p>
        <h1 className="mt-5 font-display text-4xl leading-[1.05] sm:text-5xl">
          How we show our work
        </h1>
        <p className="mt-5 text-base leading-relaxed text-ink-muted">
          This page states the standards the system is held to. It is written for buyers and
          reviewers who need to check the method, not the pitch.
        </p>

        <dl className="mt-12 divide-y divide-[color:var(--ink-border)] border-t border-ink-border">
          {sections.map((s) => (
            <div key={s.title} className="py-7">
              <dt className="font-display text-xl">{s.title}</dt>
              <dd className="mt-2.5 text-base leading-relaxed text-ink-muted">{s.body}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-10 rounded-md border border-ink-border bg-slate/60 p-6">
          <p className="label-mono text-ink-muted">Status legend</p>
          <ul className="mt-4 space-y-2 font-mono text-xs">
            <li className="text-verified">
              VERIFIED · outcome confirmed or 3+ independent sources
            </li>
            <li className="text-signal">TRACKING · within an open timing window</li>
            <li className="text-flag">CONTRADICTION · sources conflict, confidence reduced</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
