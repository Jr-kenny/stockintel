import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowUpRight, FileCheck2, GitBranch } from "lucide-react";
import { useEffect, useState } from "react";
import {
  ContradictionNote,
  ConfidenceValue,
  EvidenceMarker,
  SectionHeading,
  SignalRule,
  StatusPill,
  type StatusTone,
} from "@/components/app/AppUI";
import {
  getOpportunityLive,
  type EvidenceItem,
  type OpportunityView,
} from "@/lib/orchestrator/workspace";
import { PrivyIdentity, type PrivyIdentityInfo } from "@/components/app/privy-identity";

export const Route = createFileRoute("/app/opportunities/$id")({
  head: () => ({
    meta: [
      { title: "Assessment · StockIntel workspace" },
      { name: "robots", content: "noindex" },
    ],
  }),
  notFoundComponent: OpportunityNotFound,
  component: OpportunityDetail,
});

function toneFor(status: "verified" | "flagged" | "open"): StatusTone {
  if (status === "flagged") return "flagged";
  if (status === "open") return "tracking";
  return "verified";
}

function OpportunityNotFound() {
  return (
    <div className="app-content">
      <h1 className="font-display text-2xl">This case is no longer on file</h1>
      <Link
        to="/app"
        className="mt-4 inline-flex items-center gap-2 text-sm text-signal hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden /> Back to Intelligence
      </Link>
    </div>
  );
}

function OpportunityDetail() {
  const { id } = Route.useParams();
  const [privy, setPrivy] = useState<PrivyIdentityInfo>({
    authenticated: false,
    email: null,
    walletAddress: null,
    firstWallet: null,
  });
  const identity = privy.email ?? privy.walletAddress ?? null;
  const [data, setData] = useState<(OpportunityView & { evidence: EvidenceItem[] }) | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setMissing(false);
    if (!identity) return () => {
      cancelled = true;
    };
    void getOpportunityLive({ data: { id, identity } }).then((row) => {
      if (cancelled) return;
      if (row) setData(row);
      else setMissing(true);
    });
    return () => {
      cancelled = true;
    };
  }, [id, identity]);

  if (!identity)
    return (
      <div className="app-content">
        <PrivyIdentity onChange={setPrivy} />
        <p className="rounded-sm border border-dashed border-border p-8 text-center text-sm leading-relaxed text-muted-foreground">
          Sign in to open this assessment. Case files belong to the workspace that ran them.
        </p>
      </div>
    );
  if (missing) return <OpportunityNotFound />;
  if (!data) {
    return (
      <div className="app-content">
        <p className="font-mono text-xs text-muted-foreground">Loading dossier…</p>
      </div>
    );
  }

  const opportunity = data;
  const evidence = opportunity.evidence;
  const independentSources = new Set(evidence.map((item) => item.source)).size;
  const tone = toneFor(opportunity.status);

  return (
    <div>
      <PrivyIdentity onChange={setPrivy} />
      <header className="app-overview-hero">
        <div className="app-overview-hero-inner">
          <Link
            to="/app"
            className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.1em] text-ink-muted hover:text-signal"
          >
            <ArrowLeft className="size-3.5" aria-hidden /> Intelligence command
          </Link>
          <div className="mt-9 flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="label-mono text-signal">Intelligence dossier · {opportunity.id}</p>
              <h1 className="mt-3 max-w-3xl uppercase">{opportunity.company}</h1>
              <p className="mt-3 font-mono text-xs uppercase tracking-[0.08em] text-ink-muted">
                {opportunity.location} · {opportunity.industry}
              </p>
            </div>
            <StatusPill
              tone={tone}
              {...(opportunity.status === "verified" ? { label: "High-confidence case" } : {})}
            />
          </div>

          <dl className="mt-9 grid gap-6 border-t border-ink-border pt-5 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="label-mono text-ink-muted">Likely need</dt>
              <dd className="mt-2 font-display text-xl text-vellum">{opportunity.need}</dd>
            </div>
            <div>
              <dt className="label-mono text-ink-muted">Confidence</dt>
              <dd className="mt-2">
                <ConfidenceValue
                  value={opportunity.confidence}
                  delta={opportunity.delta}
                  tone={tone}
                />
              </dd>
            </div>
            <div>
              <dt className="label-mono text-ink-muted">Estimated buying window</dt>
              <dd className="mt-2 font-mono text-sm text-vellum">{opportunity.window}</dd>
            </div>
            <div>
              <dt className="label-mono text-ink-muted">Estimated opportunity</dt>
              <dd className="mt-2 font-mono text-sm text-vellum">{opportunity.size}</dd>
            </div>
          </dl>
        </div>
      </header>

      <div className="app-content">
        <div className="grid gap-10 xl:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)]">
          <div className="min-w-0 space-y-10">
            <section aria-labelledby="why-prime-believes">
              <SectionHeading
                eyebrow="Inference record"
                title="Why StockIntel flags this"
                action={
                  <span className="label-mono text-muted-foreground">5 reasons attached</span>
                }
              />
              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                {opportunity.summary}
              </p>
              <ol className="mt-5 border-t border-border">
                {opportunity.reasons.map((reason, index) => (
                  <li key={reason} className="app-signal-rule">
                    <span className="font-mono text-xs text-signal">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span>{reason}</span>
                  </li>
                ))}
              </ol>
            </section>

            <section aria-labelledby="evidence-trail">
              <SectionHeading
                eyebrow="Case file"
                title="Evidence trail"
                action={
                  <span className="label-mono text-muted-foreground">
                    {independentSources} independent sources
                  </span>
                }
              />
              <div className="surface mt-5 p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
                  <div className="flex items-center gap-3">
                    <span className="grid size-8 place-items-center border border-signal text-signal">
                      <FileCheck2 className="size-4" aria-hidden />
                    </span>
                    <div>
                      <p className="font-display text-lg">Clustered evidence record</p>
                      <p className="font-mono text-[0.65rem] text-muted-foreground">
                        Duplicate citations collapse into the source beneath them
                      </p>
                    </div>
                  </div>
                  <span className="font-mono text-xs text-signal">
                    {evidence.length} records · {independentSources} sources
                  </span>
                </div>
                <div className="mt-1">
                  {evidence.map((item) => (
                    <div key={item.id} className="app-evidence-marker">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="label-mono text-signal">{item.id}</span>
                            <StatusPill tone={toneFor(item.status)} compact />
                          </div>
                          <p className="mt-2 font-medium">{item.claim}</p>
                          <p className="mt-1 font-mono text-[0.66rem] leading-relaxed text-muted-foreground">
                            {item.source} · {item.sourceType}
                          </p>
                          <p className="mt-1 font-mono text-[0.66rem] text-muted-foreground">
                            Observed {item.observed}
                          </p>
                          {item.note && (
                            <p
                              className={`mt-2 font-mono text-[0.66rem] ${item.status === "flagged" ? "text-flag" : "text-muted-foreground"}`}
                            >
                              {item.note}
                            </p>
                          )}
                        </div>
                        <span className="font-mono text-[0.62rem] text-muted-foreground">
                          SOURCE {independentSources === 1 ? "01" : "CLUSTERED"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {opportunity.contradiction && (
              <section aria-labelledby="contradictions">
                <SectionHeading eyebrow="Unresolved edge" title="Disagreement stays visible" />
                <div className="mt-5">
                  <ContradictionNote>{opportunity.contradiction}</ContradictionNote>
                </div>
              </section>
            )}

            <section aria-labelledby="timeline">
              <SectionHeading eyebrow="Movement over time" title="Timeline" />
              <ol className="app-timeline-line mt-5">
                {opportunity.timeline.map((entry) => (
                  <li key={`${entry.period}-${entry.event}`} className="app-timeline-item">
                    <p className="app-timeline-period">{entry.period}</p>
                    <p className="app-timeline-event">{entry.event}</p>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <aside className="space-y-8">

            {opportunity.otherNeeds.length > 0 && (
              <section className="surface p-5 sm:p-6" aria-labelledby="other-needs">
                <SectionHeading eyebrow="Same company node" title="Other emerging needs" />
                <ul className="mt-5">
                  {opportunity.otherNeeds.map((need) => (
                    <li key={need.need} className="app-stat-rule first:border-t-0 first:pt-0">
                      <span className="app-stat-rule-label">{need.need}</span>
                      <span className="app-stat-rule-value signal">{need.confidence}%</span>
                    </li>
                  ))}
                </ul>
                <Link
                  to="/app/demand-graph"
                  className="mt-5 inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.1em] text-signal hover:text-ink"
                >
                  Open in Exposure Graph <GitBranch className="size-3.5" aria-hidden />
                </Link>
              </section>
            )}

            <section className="surface-dark p-5 sm:p-6">
              <p className="label-mono text-signal">Next useful action</p>
              <h2 className="mt-2 font-display text-xl text-vellum">
                Compare this case with your watchlist
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-ink-muted">
                StockIntel has a watchlist entry that can be checked against this exposure and its
                timing.
              </p>
              <Link
                to="/app/supply"
                className="mt-5 inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.1em] text-signal hover:text-vellum"
              >
                Review watchlist entries <ArrowUpRight className="size-3.5" aria-hidden />
              </Link>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
