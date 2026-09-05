import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronDown } from "lucide-react";

export const Route = createFileRoute("/product")({
  head: () => ({
    meta: [
      { title: "Product · query the Demand Graph" },
      {
        name: "description",
        content:
          "Describe what you have to move and see a short list of companies forming a need, each with confidence, timing, and an expandable evidence trail.",
      },
      { property: "og:title", content: "Product · query the Demand Graph" },
      {
        property: "og:description",
        content:
          "An interactive demand query: matched companies with confidence scores and expandable evidence trails.",
      },
    ],
  }),
  component: Product,
});

type Result = {
  company: string;
  location: string;
  signal: string;
  confidence: number;
  window: string;
  status: "verified" | "flagged" | "open";
  evidence: { id: string; source: string; observed: string; note: string }[];
};

const RESULTS: Result[] = [
  {
    company: "Marlowe Bay Hotels",
    location: "Lagos, NG",
    signal: "Building permit filed for a 150-room property, fit-out tender expected",
    confidence: 82,
    window: "45 days",
    status: "verified",
    evidence: [
      {
        id: "EV-4471-A",
        source: "Lagos planning portal",
        observed: "2026-07-28",
        note: "Permit LP-88214, 150 keys",
      },
      {
        id: "EV-4471-B",
        source: "Regional trade press",
        observed: "2026-08-02",
        note: "Opening targeted for Q4",
      },
      {
        id: "EV-4471-C",
        source: "Company filing",
        observed: "2026-08-09",
        note: "Capex line for guest-room AV",
      },
    ],
  },
  {
    company: "Ilona Hospitality Group",
    location: "Abuja, NG",
    signal: "Four new restaurant leases signed, fit-out contractor appointed",
    confidence: 64,
    window: "90 days",
    status: "open",
    evidence: [
      {
        id: "EV-4472-A",
        source: "Commercial lease registry",
        observed: "2026-07-19",
        note: "4 sites, 3,100 sqm total",
      },
      {
        id: "EV-4472-B",
        source: "Contractor announcement",
        observed: "2026-08-04",
        note: "Fit-out start September",
      },
    ],
  },
  {
    company: "Corvine Serviced Living",
    location: "Accra, GH",
    signal: "88 serviced apartments being furnished; unit count disputed between sources",
    confidence: 47,
    window: "unresolved",
    status: "flagged",
    evidence: [
      {
        id: "EV-4473-A",
        source: "Developer website",
        observed: "2026-06-30",
        note: "88 units listed",
      },
      {
        id: "EV-4473-B",
        source: "Local press",
        observed: "2026-07-11",
        note: "Reports 52 units, conflicts with EV-4473-A",
      },
      {
        id: "EV-4473-C",
        source: "Procurement notice",
        observed: "2026-08-01",
        note: "Soft furnishings only; AV not scoped",
      },
    ],
  },
];

const statusText: Record<Result["status"], string> = {
  verified: "text-verified",
  flagged: "text-flag",
  open: "text-signal",
};

const statusLabel: Record<Result["status"], string> = {
  verified: "VERIFIED",
  flagged: "CONTRADICTION",
  open: "TRACKING",
};

function ResultCard({ r }: { r: Result }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-md border border-border bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div>
          <h3 className="font-display text-xl">{r.company}</h3>
          <p className="label-mono mt-1 text-muted-foreground">{r.location}</p>
        </div>
        <div className="text-right">
          <p className={`font-mono text-2xl ${statusText[r.status]}`}>{r.confidence}%</p>
          <p className={`label-mono ${statusText[r.status]}`}>{statusLabel[r.status]}</p>
        </div>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{r.signal}</p>
      <p className="mt-2 font-mono text-xs text-muted-foreground">
        LIKELY WINDOW {r.window} · {r.evidence.length} INDEPENDENT SOURCES
      </p>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mt-4 inline-flex items-center gap-1.5 rounded-sm border border-border px-3 py-1.5 text-xs transition-colors hover:border-signal hover:text-signal"
      >
        <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        {open ? "Hide evidence trail" : "Evidence trail"}
      </button>
      {open && (
        <ul className="mt-4 space-y-2 border-t border-border pt-4">
          {r.evidence.map((e) => (
            <li key={e.id} className="font-mono text-xs leading-relaxed">
              <span className="text-signal">{e.id}</span>{" "}
              <span className="text-foreground">{e.source}</span>{" "}
              <span className="text-muted-foreground">
                · {e.observed} · {e.note}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Product() {
  const [query, setQuery] = useState(
    "I have 5,000 TCL TVs available in Nigeria, minimum order 20 units",
  );
  const [state, setState] = useState<"idle" | "running" | "done">("idle");

  function run(e: React.FormEvent) {
    e.preventDefault();
    setState("running");
    window.setTimeout(() => setState("done"), 700);
  }

  return (
    <div className="flex-1 bg-vellum text-ink">
      <section className="mx-auto max-w-4xl px-5 py-16 sm:px-8 sm:py-24">
        <p className="label-mono text-signal">Query</p>
        <h1 className="mt-5 font-display text-4xl leading-[1.05] sm:text-5xl">
          Describe what you have to move
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground">
          The system reads the supply, then searches the Demand Graph for companies whose situation
          has changed in a way that creates the matching need.
        </p>

        <form onSubmit={run} className="mt-8">
          <label htmlFor="supply" className="label-mono text-muted-foreground">
            Supply description
          </label>
          <textarea
            id="supply"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            rows={3}
            className="mt-2 w-full rounded-sm border border-input bg-card p-4 font-mono text-sm text-foreground"
          />
          <button
            type="submit"
            className="mt-3 rounded-sm bg-ink px-5 py-2.5 text-sm font-medium text-vellum transition-opacity hover:opacity-90"
          >
            {state === "running" ? "Searching…" : "Find demand"}
          </button>
        </form>

        {state === "running" && (
          <p className="mt-8 font-mono text-xs text-muted-foreground">
            Clustering evidence across 1,284 signals…
          </p>
        )}

        {state === "done" && (
          <div className="mt-12">
            <p className="label-mono text-muted-foreground">
              3 matches · ranked by confidence · evidence attached
            </p>
            <ul className="mt-4 space-y-4">
              {RESULTS.map((r) => (
                <ResultCard key={r.company} r={r} />
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
