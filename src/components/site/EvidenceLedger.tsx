import { useEffect, useState } from "react";

type Entry = {
  id: string;
  signal: string;
  evidence: string;
  confidence: number;
  need: string;
  status: "verified" | "flagged" | "open";
};

/**
 * Landing-page ledger: ILLUSTRATIVE SAMPLE entries showing the shape of a
 * readout. Real buyer activity is confidential and lives only inside the
 * signed-in workspace.
 */
const SAMPLE_ENTRIES: Entry[] = [
  {
    id: "EV-2081",
    signal: "Tampa, regional hospital network approves 120-bed wing",
    evidence: "4 independent sources, clustered",
    confidence: 81,
    need: "medical displays, networking, backup power, within 90 days",
    status: "verified",
  },
  {
    id: "EV-2082",
    signal: "Lagos, hotel group files permit for a 150-room tower",
    evidence: "3 independent sources, clustered",
    confidence: 64,
    need: "televisions, HVAC, mattresses, within 120 days",
    status: "open",
  },
  {
    id: "EV-2083",
    signal: "Manchester, fulfilment operator leases two warehouses; opening quarter disputed",
    evidence: "5 sources, one contradicted",
    confidence: 52,
    need: "shelving, scanners, staff hardware, timing unresolved",
    status: "flagged",
  },
  {
    id: "EV-2084",
    signal: "Nairobi, supermarket chain announces 8 new branches",
    evidence: "4 independent sources, clustered",
    confidence: 77,
    need: "refrigeration, POS terminals, generators, within 60 days",
    status: "verified",
  },
];

const statusText: Record<Entry["status"], string> = {
  verified: "text-verified",
  flagged: "text-flag",
  open: "text-signal",
};

const statusLabel: Record<Entry["status"], string> = {
  verified: "VERIFIED",
  flagged: "CONTRADICTION",
  open: "TRACKING",
};

function Row({ entry }: { entry: Entry }) {
  return (
    <li className="animate-ledger-in border-t border-ink-border px-4 py-4 first:border-t-0 sm:px-6">
      <div className="flex items-baseline justify-between gap-4">
        <span className="label-mono text-ink-muted">{entry.id}</span>
        <span className={`label-mono ${statusText[entry.status]}`}>
          {statusLabel[entry.status]}
        </span>
      </div>
      <dl className="mt-3 space-y-1.5 font-mono text-[0.8125rem] leading-relaxed">
        <div className="flex flex-col gap-x-4 sm:flex-row">
          <dt className="w-32 shrink-0 text-signal">SIGNAL</dt>
          <dd className="text-vellum">{entry.signal}</dd>
        </div>
        <div className="flex flex-col gap-x-4 sm:flex-row">
          <dt className="w-32 shrink-0 text-ink-muted">EVIDENCE</dt>
          <dd className="text-ink-muted">{entry.evidence}</dd>
        </div>
        <div className="flex flex-col gap-x-4 sm:flex-row">
          <dt className="w-32 shrink-0 text-ink-muted">CONFIDENCE</dt>
          <dd className={statusText[entry.status]}>{entry.confidence}%</dd>
        </div>
        <div className="flex flex-col gap-x-4 sm:flex-row">
          <dt className="w-32 shrink-0 text-ink-muted">LIKELY NEED</dt>
          <dd className="text-vellum">{entry.need}</dd>
        </div>
      </dl>
    </li>
  );
}

export function EvidenceLedger() {
  const [index, setIndex] = useState(0);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    setLive(true);
    const cadence = window.innerWidth < 640 ? 7000 : 4500;
    const t = window.setInterval(() => setIndex((i) => (i + 1) % SAMPLE_ENTRIES.length), cadence);
    return () => window.clearInterval(t);
  }, []);

  const visible: Entry[] = live
    ? [0, 1, 2].map((o) => SAMPLE_ENTRIES[(index + o) % SAMPLE_ENTRIES.length]!)
    : SAMPLE_ENTRIES.slice(0, 3);

  return (
    <section
      aria-label="Sample readout"
      className="rounded-md border border-ink-border bg-slate/60"
    >
      <div className="flex items-center justify-between border-b border-ink-border px-4 py-3 sm:px-6">
        <span className="label-mono text-ink-muted">Evidence ledger · sample readout</span>
        <span className="label-mono text-signal">what you'll see inside</span>
      </div>
      <ul>
        {visible.map((entry) => (
          <Row key={entry.id} entry={entry} />
        ))}
      </ul>
      <p className="border-t border-ink-border px-4 py-3 font-mono text-[0.64rem] leading-relaxed text-ink-muted sm:px-6">
        Illustrative example. Every readout in your workspace carries exactly this structure,
        filled with your own sourced, graded results. Buyer searches stay private to the buyer.
      </p>
    </section>
  );
}
