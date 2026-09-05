import { createFileRoute } from "@tanstack/react-router";
import { ChevronDown, FileSearch, Layers3, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/app/AppShell";
import { PrivyIdentity, type PrivyIdentityInfo } from "@/components/app/privy-identity";
import { SectionHeading, StatusPill, type StatusTone } from "@/components/app/AppUI";
import { listEvidenceLive, statusLabel, type EvidenceItem } from "@/lib/orchestrator/workspace";

export const Route = createFileRoute("/app/evidence")({
  head: () => ({
    meta: [
      { title: "Evidence · StockIntel workspace" },
      {
        name: "description",
        content:
          "Every claim StockIntel holds, with its source, when it was observed and whether anything contradicts it.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: EvidencePage,
});

const STATUSES = ["All", "Verified", "Contradicted", "Tracking"] as const;

function toneFor(status: "verified" | "flagged" | "open"): StatusTone {
  if (status === "flagged") return "flagged";
  if (status === "open") return "tracking";
  return "verified";
}

function EvidencePage() {
  const [all, setAll] = useState<EvidenceItem[] | null>(null);
  const [company, setCompany] = useState("All companies");
  const [privy, setPrivy] = useState<PrivyIdentityInfo>({
    authenticated: false,
    email: null,
    walletAddress: null,
    firstWallet: null,
  });
  const identity = privy.email ?? privy.walletAddress ?? null;
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("All");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!identity) {
      setAll([]);
      return;
    }
    void listEvidenceLive({ data: { identity } }).then(setAll);
  }, [identity]);

  const rows = useMemo(
    () =>
      (all ?? []).filter(
        (item) =>
          (company === "All companies" || item.company === company) &&
          (status === "All" ||
            item.status ===
              (status === "Verified"
                ? "verified"
                : status === "Contradicted"
                  ? "flagged"
                  : "open")),
      ),
    [all, company, status],
  );

  const COMPANIES = useMemo(
    () => ["All companies", ...Array.from(new Set((all ?? []).map((item) => item.company)))],
    [all],
  );
  const sources = new Set(rows.map((item) => item.source)).size;
  const contradictions = rows.filter((item) => item.status === "flagged").length;

  return (
    <div>
      <PrivyIdentity onChange={setPrivy} />
      <PageHeader
        eyebrow="Evidence register"
        title="The record behind every conclusion"
        intro="Duplicate citations are clustered, not counted twice. Disagreement is preserved rather than averaged away. This is the paper trail beneath the assessment register."
      >
        <div className="flex shrink-0 items-center gap-3 border-l border-border pl-5">
          <FileSearch className="size-4 text-signal" aria-hidden />
          <div>
            <p className="label-mono text-muted-foreground">Current view</p>
            <p className="mt-1 font-mono text-xs">
              {rows.length} records · {sources} sources
            </p>
          </div>
        </div>
      </PageHeader>

      <div className="app-content">
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)]">
          <section>
            <SectionHeading
              eyebrow="Trace every claim"
              title="Evidence ledger"
              action={
                <span className="label-mono text-muted-foreground">
                  {contradictions} contradiction visible
                </span>
              }
            />

            <div className="mt-6 flex flex-wrap gap-3">
              <label className="min-w-44 flex-1">
                <span className="app-form-label">Company</span>
                <select
                  value={company}
                  onChange={(event) => setCompany(event.target.value)}
                  className="app-select mt-2"
                >
                  {COMPANIES.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="app-filter-row mt-4">
              {STATUSES.map((statusOption) => (
                <button
                  key={statusOption}
                  type="button"
                  data-active={status === statusOption}
                  aria-pressed={status === statusOption}
                  className="app-filter-button"
                  onClick={() => setStatus(statusOption)}
                >
                  {statusOption}
                </button>
              ))}
            </div>

            <div className="surface mt-5 overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b border-border bg-secondary/40 px-4 py-3 sm:px-5">
                <p className="font-mono text-[0.65rem] text-muted-foreground">
                  {rows.length} evidence items in view
                </p>
                <p className="font-mono text-[0.65rem] text-signal">
                  {sources} independent sources after clustering
                </p>
              </div>
              {!identity ? (
                <p className="p-10 text-center text-sm text-muted-foreground">
                  Sign in to see the evidence behind your watches.
                </p>
              ) : rows.length === 0 ? (
                <p className="p-10 text-center text-sm text-muted-foreground">
                  No evidence matches these filters.
                </p>
              ) : (
                <ul>
                  {rows.map((item) => {
                    const isExpanded = expanded === item.id;
                    return (
                      <li key={item.id} className="border-b border-border last:border-b-0">
                        <button
                          type="button"
                          className="w-full p-4 text-left transition-colors hover:bg-signal/5 sm:p-5"
                          aria-expanded={isExpanded}
                          onClick={() => setExpanded(isExpanded ? null : item.id)}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                <span className="label-mono text-signal">{item.id}</span>
                                <StatusPill
                                  tone={toneFor(item.status)}
                                  label={statusLabel[item.status]}
                                  compact
                                />
                              </div>
                              <p className="mt-3 font-display text-lg">{item.company}</p>
                              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                                {item.claim}
                              </p>
                            </div>
                            <ChevronDown
                              className={`mt-1 size-4 shrink-0 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`}
                              aria-hidden
                            />
                          </div>
                          <div className="mt-4 grid gap-x-6 gap-y-2 border-t border-border pt-3 font-mono text-[0.64rem] text-muted-foreground sm:grid-cols-2 lg:grid-cols-3">
                            <span>
                              <b className="font-normal text-ink">SOURCE</b> {item.source}
                            </span>
                            <span>
                              <b className="font-normal text-ink">TYPE</b> {item.sourceType}
                            </span>
                            <span>
                              <b className="font-normal text-ink">OBSERVED</b> {item.observed}
                            </span>
                          </div>
                          {isExpanded && (
                            <div className="mt-4 border-t border-border pt-4">
                              <p className="label-mono text-muted-foreground">
                                Cluster interpretation
                              </p>
                              <p className="mt-2 max-w-2xl text-sm leading-relaxed">
                                This record contributes one underlying source to the confidence
                                calculation. The same source may appear in several records without
                                increasing the independent-source count.
                              </p>
                              {item.note && (
                                <p
                                  className={`mt-3 font-mono text-xs ${item.status === "flagged" ? "text-flag" : "text-muted-foreground"}`}
                                >
                                  {item.note}
                                </p>
                              )}
                            </div>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          <aside className="space-y-8">
            <section className="surface-dark p-5 sm:p-6" aria-labelledby="cluster-rule">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="label-mono text-signal">Scoring boundary</p>
                  <h2 className="mt-2 font-display text-2xl text-vellum">
                    Repetition is not corroboration.
                  </h2>
                </div>
                <Layers3 className="size-5 text-signal" aria-hidden />
              </div>
              <p className="mt-4 text-sm leading-relaxed text-ink-muted">
                Five citations of one article produce one source cluster. A separate permit, filing
                or hiring signal can add independence. The interface reports both counts so the
                difference is visible.
              </p>
              <div className="mt-6 border-t border-ink-border pt-5">
                <p className="label-mono text-ink-muted">Current register</p>
                <dl className="mt-4 grid grid-cols-2 gap-4">
                  <div>
                    <dt className="font-mono text-xs text-ink-muted">RECORDS</dt>
                    <dd className="mt-1 font-mono text-2xl text-vellum">{rows.length}</dd>
                  </div>
                  <div>
                    <dt className="font-mono text-xs text-ink-muted">SOURCE CLUSTERS</dt>
                    <dd className="mt-1 font-mono text-2xl text-signal">{sources}</dd>
                  </div>
                </dl>
              </div>
            </section>

            <section className="surface p-5 sm:p-6">
              <SectionHeading
                eyebrow="What the evidence can say"
                title="Useful records have a shape"
              />
              <ul className="mt-5 space-y-3 text-sm leading-relaxed">
                <li className="border-t border-border pt-3">
                  <span className="font-medium">Claim</span> · what changed or was observed.
                </li>
                <li className="border-t border-border pt-3">
                  <span className="font-medium">Source</span> · where the observation came from.
                </li>
                <li className="border-t border-border pt-3">
                  <span className="font-medium">Observed</span> · when it was seen.
                </li>
                <li className="border-t border-border pt-3">
                  <span className="font-medium">Status</span> · verified, tracking or contradicted.
                </li>
              </ul>
              <div className="mt-6 flex items-start gap-3 border-t border-border pt-4">
                <ShieldCheck className="size-4 shrink-0 text-verified" aria-hidden />
                <p className="font-mono text-[0.65rem] leading-relaxed text-muted-foreground">
                  Confidence is never asserted without a source behind it.
                </p>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
