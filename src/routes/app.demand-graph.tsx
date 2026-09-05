import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowDown, ArrowUpRight, Building2, CircleHelp, Network } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/app/AppShell";
import { PrivyIdentity, type PrivyIdentityInfo } from "@/components/app/privy-identity";
import { SectionHeading } from "@/components/app/AppUI";
import {
  listEvidenceLive,
  listOpportunitiesLive,
  listSupplyLive,
  type EvidenceItem,
  type OpportunityView,
  type SupplyView,
} from "@/lib/orchestrator/workspace";

export const Route = createFileRoute("/app/demand-graph")({
  head: () => ({
    meta: [
      { title: "Exposure Graph · StockIntel workspace" },
      {
        name: "description",
        content:
          "Inspect how a company's events lead to changing situations, probable needs, timing and confidence, with the evidence behind each edge.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DemandGraph,
});

type Selection =
  | { kind: "company" }
  | { kind: "event"; value: string }
  | { kind: "need"; value: string; confidence: number };

const EVENT_MEANING: Record<string, string> = {
  "Hyperscale buildout approved":
    "Committed data-center capacity converts into accelerator, memory and networking orders on a fixed construction timetable.",
  "Capex guide raised":
    "A raised capital-expenditure guide names where the money goes. Suppliers and infrastructure names move first.",
  "Capacity expansion":
    "New production capacity changes the supply baseline for every downstream buyer within quarters.",
  "Supplier contract won":
    "A disclosed contract converts pipeline into revenue and reprices everyone exposed to the same chain.",
  "New facility announced":
    "A new site sets hard quantities for equipment, power and networking once construction begins.",
  "Fit-out approaching":
    "Fit-out is the point at which hardware budgets commit and supplier exposure peaks.",
  "Procurement beginning":
    "Tender preparation narrows the impact window to weeks rather than quarters.",
  "New site energy deal":
    "A power agreement removes the binding constraint on a build, pulling forward equipment demand.",
  "Leadership change":
    "A new owner of a P&L reliably precedes a re-scoped budget within two quarters.",
  "Security incident": "A disclosed incident converts a deferred risk budget into a funded one.",
  "Regulated-market entry":
    "A new regulated market imposes costs the current setup was not scoped for.",
  "Earnings surprise":
    "A surprise resets expectations for the whole exposure chain, not just the reporter.",
};

function DemandGraph() {
  const [privy, setPrivy] = useState<PrivyIdentityInfo>({
    authenticated: false,
    email: null,
    walletAddress: null,
    firstWallet: null,
  });
  const identity = privy.email ?? privy.walletAddress ?? null;
  const [opps, setOpps] = useState<OpportunityView[] | null>(null);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [supply, setSupply] = useState<SupplyView[]>([]);
  const [company, setCompany] = useState<string>("");
  const [selection, setSelection] = useState<Selection>({ kind: "company" });

  useEffect(() => {
    if (!identity) {
      setOpps([]);
      setEvidence([]);
      setSupply([]);
      return;
    }
    void listOpportunitiesLive({ data: { identity } }).then((rows) => {
      setOpps(rows);
      if (rows.length > 0) setCompany((current) => current || rows[0]!.company);
    });
    void listEvidenceLive({ data: { identity } }).then(setEvidence);
    void listSupplyLive({ data: { identity } }).then(setSupply);
  }, [identity]);

  const companies = useMemo(
    () => Array.from(new Set([...(opps ?? []).map((o) => o.company)])),
    [opps],
  );
  const opportunity = (opps ?? []).find((item) => item.company === company);
  const events = evidence
    .filter((item) => item.company === company)
    .slice(0, 4)
    .map((item) => item.claim.slice(0, 80));
  const needs = opportunity ? [{ need: opportunity.need, confidence: opportunity.confidence }] : [];
  const companyEvidence = evidence.filter((item) => item.company === company);

  function selectCompany(nextCompany: string) {
    setCompany(nextCompany);
    setSelection({ kind: "company" });
  }

  return (
    <div>
      <PrivyIdentity onChange={setPrivy} />
      <PageHeader
        eyebrow="Exposure Graph"
        title="Follow the event, not the ticker"
        intro="The graph maps how companies connect: customers, suppliers, partners, projects, industries, related assets. An event anywhere on it, a data-center expansion, a capacity guide, a contract, travels along those edges until it reaches your tickers. Each edge carries timing, confidence and evidence."
      >
        <div className="flex shrink-0 items-center gap-3 border-l border-border pl-5">
          <Network className="size-4 text-signal" aria-hidden />
          <div>
            <p className="label-mono text-muted-foreground">Graph view</p>
            <p className="mt-1 font-mono text-xs">{company} · impact window</p>
          </div>
        </div>
      </PageHeader>

      <div className="app-content">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Company nodes">
          {companies.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={company === item}
              data-active={company === item}
              className="app-filter-button"
              onClick={() => selectCompany(item)}
            >
              {item}
            </button>
          ))}
        </div>

        <div className="mt-6 grid gap-8 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
          <section className="app-graph-surface" aria-label="Exposure Graph relationship view">
            <div className="app-graph-inner">
              <div className="flex items-start justify-between gap-5 border-b border-ink-border pb-5">
                <div>
                  <p className="label-mono text-signal">Selected company node</p>
                  <h2 className="mt-2 font-display text-2xl text-vellum">{company}</h2>
                  <p className="mt-1 font-mono text-xs text-ink-muted">
                    {opportunity?.location} · {opportunity?.industry}
                  </p>
                </div>
                <Building2 className="size-5 text-signal" aria-hidden />
              </div>

              <div className="mt-6 grid gap-3 lg:grid-cols-[minmax(0,0.85fr)_auto_minmax(0,1.1fr)_auto_minmax(0,0.9fr)] lg:items-stretch">
                <div>
                  <p className="app-graph-node-label">Company</p>
                  <button
                    type="button"
                    className="app-graph-node mt-2"
                    data-selected={selection.kind === "company"}
                    onClick={() => setSelection({ kind: "company" })}
                  >
                    <span className="app-graph-node-title">{company}</span>
                    <span className="app-graph-node-copy">
                      The node StockIntel is watching for meaningful change.
                    </span>
                  </button>
                </div>

                <div className="app-graph-connector">
                  <ArrowDown className="size-4 lg:hidden" aria-hidden />
                  <span className="hidden lg:inline">hits</span>
                </div>

                <div>
                  <p className="app-graph-node-label">Events</p>
                  <ul className="mt-2 space-y-2">
                    {events.map((event) => (
                      <li key={event}>
                        <button
                          type="button"
                          className="app-graph-node"
                          data-selected={selection.kind === "event" && selection.value === event}
                          onClick={() => setSelection({ kind: "event", value: event })}
                        >
                          <span className="app-graph-node-title text-[0.95rem]">{event}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="app-graph-connector">
                  <ArrowDown className="size-4 lg:hidden" aria-hidden />
                  <span className="hidden lg:inline">exposes</span>
                </div>

                <div>
                  <p className="app-graph-node-label">Resulting exposure</p>
                  <ul className="mt-2 space-y-2">
                    {needs.map((need) => (
                      <li key={need.need}>
                        <button
                          type="button"
                          className="app-graph-node"
                          data-selected={selection.kind === "need" && selection.value === need.need}
                          onClick={() =>
                            setSelection({
                              kind: "need",
                              value: need.need,
                              confidence: need.confidence,
                            })
                          }
                        >
                          <span className="app-graph-node-title text-[0.95rem]">{need.need}</span>
                          <span className="mt-2 block font-mono text-lg text-signal">
                            {need.confidence}%
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="mt-7 grid gap-4 border-t border-ink-border pt-5 sm:grid-cols-3">
                <div>
                  <p className="app-graph-node-label">Timing</p>
                  <p className="mt-2 font-mono text-sm text-vellum">
                    {opportunity?.window ?? "Unresolved"}
                  </p>
                </div>
                <div>
                  <p className="app-graph-node-label">Evidence attached</p>
                  <p className="mt-2 font-mono text-sm text-vellum">
                    {companyEvidence.length || opportunity?.evidenceIds.length || 0} records
                  </p>
                </div>
                <div>
                  <p className="app-graph-node-label">Question answered</p>
                  <p className="mt-2 font-mono text-sm text-signal">Why now?</p>
                </div>
              </div>
            </div>
          </section>

          <aside className="surface p-5 sm:p-6" aria-live="polite">
            {selection.kind === "company" && (
              <>
                <SectionHeading eyebrow="Ticker node" title="What moved recently" />
                <ol className="app-timeline-line mt-6">
                  {(opportunity?.timeline ?? []).map((entry) => (
                    <li key={`${entry.period}-${entry.event}`} className="app-timeline-item">
                      <p className="app-timeline-period">{entry.period}</p>
                      <p className="app-timeline-event">{entry.event}</p>
                    </li>
                  ))}
                </ol>
              </>
            )}

            {selection.kind === "event" && (
              <>
                <SectionHeading eyebrow="Event selected" title="Why this matters" />
                <h3 className="mt-5 font-display text-xl">{selection.value}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {EVENT_MEANING[selection.value] ??
                    "This event moves something the watched ticker is exposed to, through the chain above."}
                </p>
                <p className="mt-6 border-t border-border pt-4 label-mono text-muted-foreground">
                  Supporting evidence
                </p>
                <ul className="mt-3 space-y-2">
                  {companyEvidence.slice(0, 4).map((item) => (
                    <li key={item.id} className="font-mono text-xs leading-relaxed">
                      <span className="text-signal">{item.id}</span> {item.claim}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {selection.kind === "need" && (
              <>
                <SectionHeading eyebrow="Exposure selected" title="Evidence behind this exposure" />
                <h3 className="mt-5 font-display text-xl">
                  {selection.value}{" "}
                  <span className="font-mono text-signal">{selection.confidence}%</span>
                </h3>
                <ul className="mt-4 space-y-2">
                  {companyEvidence.map((item) => (
                    <li
                      key={item.id}
                      className="border-t border-border pt-3 font-mono text-xs leading-relaxed"
                    >
                      <span className="text-signal">{item.id}</span> {item.claim}
                    </li>
                  ))}
                </ul>
                <p className="mt-6 border-t border-border pt-4 label-mono text-muted-foreground">
                  Watchlist overlap
                </p>
                <ul className="mt-3 space-y-2">
                  {supply.map((record) => (
                    <li key={record.id} className="app-stat-rule first:border-t-0 first:pt-0">
                      <span className="app-stat-rule-label">{record.name}</span>
                      <span className="app-stat-rule-value signal">
                        {record.highConfidence} high-conf
                      </span>
                    </li>
                  ))}
                </ul>
                {opportunity && (
                  <Link
                    to="/app/opportunities/$id"
                    params={{ id: opportunity.id }}
                    className="mt-5 inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.1em] text-signal hover:text-ink"
                  >
                    Open dossier <ArrowUpRight className="size-3.5" aria-hidden />
                  </Link>
                )}
              </>
            )}
          </aside>
        </div>

        <div className="mt-8 grid gap-5 border-t border-border pt-6 sm:grid-cols-3">
          <div className="flex gap-3">
            <CircleHelp className="size-4 shrink-0 text-signal" aria-hidden />
            <p className="text-sm leading-relaxed text-muted-foreground">
              Click an event to see how it reaches the tickers exposed to it.
            </p>
          </div>
          <div className="flex gap-3">
            <CircleHelp className="size-4 shrink-0 text-signal" aria-hidden />
            <p className="text-sm leading-relaxed text-muted-foreground">
              Click an exposure to see the evidence and watchlist entries behind it.
            </p>
          </div>
          <div className="flex gap-3">
            <CircleHelp className="size-4 shrink-0 text-signal" aria-hidden />
            <p className="text-sm leading-relaxed text-muted-foreground">
              The graph stays legible by showing relationships, not a wall of decorative nodes.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
