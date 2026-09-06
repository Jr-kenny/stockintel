import { createFileRoute } from "@tanstack/react-router";
import { ArrowUpRight, Bot, Database, Layers3, ScanLine } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useCallback, useEffect, useRef, useState } from "react";
import { SectionHeading, StatusPill } from "@/components/app/AppUI";
import { RequireAuth } from "@/components/app/auth-gate";
import { AgentOsConnect } from "@/components/app/agent-os-connect";
import { ReportView } from "@/components/app/ReportView";
import { PrivyIdentity, type PrivyIdentityInfo } from "@/components/app/privy-identity";
import {
  getInquiry,
  listSupplyRecords,
  submitInquiry,
  listMyRuns,
  latestActiveRun,
} from "@/lib/orchestrator/fns";
export const Route = createFileRoute("/app/")({
  head: () => ({
    meta: [
      { title: "Intelligence · StockIntel" },
      {
        name: "description",
        content:
          "Name a ticker in plain language. StockIntel fans out across the events behind it, clusters evidence and ranks what is forming.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Intelligence,
});

type InquiryState = NonNullable<Awaited<ReturnType<typeof getInquiry>>>;

type ReadoutEntry = {
  company: string;
  confidence: number;
  claims: number;
  independentSources: number;
  topClaim: string;
  sources: { label: string; url: string }[];
  contributingAgents: string[];
};

/**
 * Deliberately spread across sectors and regions. All three used to be
 * semiconductors, which quietly told users the product only works on chips.
 * Nothing in the pipeline is sector-specific and the examples should say so.
 */
const EXAMPLES = [
  "Watch NVDA: what is happening in the world that could materially change its value?",
  "Watch MAERSK: which shipping and port events could move it over the next quarter?",
  "Watch DANGCEM: what capacity, contract or energy events change the Nigerian cement picture?",
];

type RunHistoryRow = {
  id: string;
  question: string;
  status: "dispatching" | "collecting" | "grading" | "complete" | "failed";
  createdAt: string | null;
  claimsReceived: number;
  sourcesClustered: number;
  complete: boolean;
  active: boolean;
  error?: string | null;
};

const FACTS = [
  "Prices react to events. The move starts before the ticker, in buildouts, filings and capacity guides.",
  "A $10B hyperscale AI buildout fans out: GPUs to NVIDIA, memory to Micron, servers to Dell, networking to Broadcom.",
  "A closed shipping lane fans out too: longer routings, tighter capacity, higher freight rates, thinner port windows.",
  "One permit plus one contractor statement beats five outlets citing the same press release.",
  "Five citations of one article count as one source. Independence is what earns confidence.",
  "A regulator speaking for itself outranks any story about it, whether that is the SEC or a tender board in Lagos.",
  "bStocks trade 24/7. Most tokenized-equity volume prints outside US market hours.",
  "Priced in is measurable: did the tape move beyond its normal daily band on the day the event landed?",
  "Second-order exposure hides alpha. Power, cooling and memory ride every data-center build.",
  "Every claim carries its evidence, and the report states what would prove it wrong.",
  "A thesis that holds only because rivals are weaker is fragile. The report says so when that is the case.",
  "The chain forms first. The market check comes second. Never the reverse.",
];

function RotatingFacts() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setI((v) => (v + 1) % FACTS.length), 3200);
    return () => window.clearInterval(id);
  }, []);
  return (
    <p className="mt-2 min-h-[2.5rem] text-sm leading-relaxed text-ink">
      <span className="font-mono text-xs text-signal">#{String(i + 1).padStart(2, "0")}</span> · {FACTS[i]}
    </p>
  );
}

/** Live sourcing countdown in seconds, then an honest grading state. */
function SourcingCountdown({
  deadlineIso,
  windowSeconds,
  grading,
  claims,
  sources,
}: {
  deadlineIso: string | null;
  windowSeconds: number;
  grading: boolean;
  claims: number;
  sources: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadlineIso || grading) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [deadlineIso, grading]);
  const remaining = deadlineIso
    ? Math.max(0, Math.ceil((Date.parse(deadlineIso) - now) / 1000))
    : null;
  const pct =
    remaining === null
      ? 100
      : Math.min(100, Math.max(0, ((windowSeconds - remaining) / windowSeconds) * 100));

  return (
    <div className="surface p-5 sm:p-6" aria-live="polite">
      <p className="label-mono text-signal">
        {grading || remaining === 0 ? "Grading the evidence" : "Sourcing across every surface"}
      </p>
      {grading || remaining === 0 ? (
        <>
          <p className="mt-2 font-mono text-lg text-ink">grading…</p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {claims === 0
              ? "The window just closed and the first claims are still landing. Grading starts the moment they do."
              : `The window is closed. ${claims} claims from ${sources} source clusters are being graded and synthesized into your readout.`}
          </p>
        </>
      ) : (
        <>
          <p className="mt-2 font-mono text-5xl tabular-nums text-ink">
            {remaining}
            <span className="text-2xl text-muted-foreground">s</span>
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            until the sourcing window closes. Then clustering, grading, your readout.
          </p>
        </>
      )}
      <div className="app-progress mt-4" aria-hidden>
        <span style={{ width: `${grading || remaining === 0 ? 100 : pct}%` }} />
      </div>
    </div>
  );
}

function Intelligence() {
  const [query, setQuery] = useState(
    "Watch NVDA: what is happening in the world that could materially change its value?",
  );
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [inquiry, setInquiry] = useState<InquiryState | null>(null);
  const [supply, setSupply] = useState<Awaited<ReturnType<typeof listSupplyRecords>>>([]);
  const [submitting, setSubmitting] = useState(false);
  const [history, setHistory] = useState<RunHistoryRow[]>([]);
  const pollRef = useRef<number | null>(null);
  const [privy, setPrivy] = useState<PrivyIdentityInfo>({
    authenticated: false,
    email: null,
    walletAddress: null,
    firstWallet: null,
  });
  const identity = privy.email ?? privy.walletAddress ?? null;

  useEffect(() => {
    void listSupplyRecords().then(setSupply);
  }, []);

  useEffect(
    () => () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    },
    [],
  );

  const poll = useCallback((inquiryId: string) => {
    try { sessionStorage.removeItem("prime-layer:dismissed"); } catch {}
    if (pollRef.current) window.clearInterval(pollRef.current);
    let ticks = 0;
    pollRef.current = window.setInterval(async () => {
      ticks += 1;
      const state = await getInquiry({ data: inquiryId });
      if (!state) return;
      setInquiry(state);
      if (state.status === "failed") {
        window.clearInterval(pollRef.current!);
        setPhase("failed");
      }
      // The report is the product: prefer runs carrying one, and accept the
      // raw readout otherwise. Legacy synthesis counts as a finished run too.
      if (state.status === "complete" && (state.report || state.synthesis)) {
        window.clearInterval(pollRef.current!);
        setPhase("done");
        if (identityRef.current) void refreshRunsRef.current?.();
      } else if (state.status === "complete" && state.readout) {
        setPhase("done");
        if (identityRef.current) void refreshRunsRef.current?.();
      }
      // A healthy cycle finishes in ~6 min. Past 12, the run is dead. Stop
      // watching instead of spinning forever.
      if (ticks > 360) {
        window.clearInterval(pollRef.current!);
        setPhase("failed");
        if (identityRef.current) void refreshRunsRef.current?.();
      }
    }, 2000);
  }, []);

  // Refs so poll can notify the history refresh without a circular dependency.
  const identityRef = useRef(identity);
  useEffect(() => {
    identityRef.current = identity;
  }, [identity]);
  const refreshRunsRef = useRef<(() => void) | null>(null);

  // Resume + history: runs belong to the account on the server. On sign-in,
  // adopt any in-flight run (refresh / dead phone / new device) and load the
  // workspace's run history. No browser storage involved.
  // If user hit New request and navigated away without running, don't snap back to last readout.
  const refreshRuns = useCallback(() => {
    if (!identity) return;
    void latestActiveRun({ data: { identity } }).then((activeRun) => {
      if (!activeRun || pollRef.current) return; // already watching something
      setPhase("running");
      poll(activeRun.id);
    });
    void listMyRuns({ data: { identity } }).then((rows) => {
      if (!rows.length) return;
      setHistory(rows);
      // If nothing is in flight, show the most recent finished readout so the
      // workspace always opens with the last result they paid for, unless the user dismissed it.
      if (phase === "idle") {
        try {
          if (sessionStorage.getItem("prime-layer:dismissed") === "1") return;
        } catch {}
        const last = rows.find((r) => r.complete);
        if (last) {
          void getInquiry({ data: last.id }).then((state) => {
            if (state?.readout?.length || state?.synthesis) {
              setInquiry(state);
              setPhase("done");
            }
          });
        }
      }
    });
  }, [identity, phase, poll]);

  useEffect(() => {
    refreshRunsRef.current = refreshRuns;
  }, [refreshRuns]);
  useEffect(() => {
    refreshRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  // Deep-link from Supply's Recent enquiries: /app?inquiry=INQ_xxx
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("inquiry");
    if (q && identity) {
      void getInquiry({ data: q }).then((state) => {
        if (state?.readout?.length || state?.synthesis) {
          setInquiry(state);
          setPhase("done");
          window.history.replaceState({}, "", "/app");
        }
      });
    }
  }, [identity]);

  async function run(event: React.FormEvent) {
    event.preventDefault();
    if (submitting || phase === "running") return;
    const submittedQuery = query;
    setSubmitting(true);
    const result = await submitInquiry({
      data: {
        question: submittedQuery,
        ...(identity
          ? {
              identity,
              ...(privy.email ? { email: privy.email } : {}),
              ...(privy.walletAddress ? { wallet: privy.walletAddress } : {}),
            }
          : {}),
      },
    });
    setSubmitting(false);
    if ("inquiryId" in result && result.inquiryId) {
      setQuery("");
      setPhase("running");
      poll(result.inquiryId);
      // Smooth scroll into results phase
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    }
  }

  const steps = buildSteps(inquiry);
  const readout = (inquiry?.readout as ReadoutEntry[] | null) ?? [];
  const synthesis = inquiry?.synthesis ?? null;
  // Null on runs from before the report pass, which is why the thesis branch
  // below still exists.
  const report = inquiry?.report ?? null;

  return (
    <div>
      <PrivyIdentity onChange={setPrivy} />
      {phase === "idle" ? (
        <section className="app-overview-hero">
          <div className="app-overview-hero-inner">
            <p className="app-overview-kicker label-mono">
              <span className="app-sync-dot" aria-hidden />
              Market intelligence command
            </p>
            <h1>Find the event before it becomes the price.</h1>
            <p className="app-overview-hero-intro">
              Name a ticker. StockIntel investigates the world behind it: buildouts,
              capex, suppliers, filings, footage. Then it checks the market to see whether
              the thesis is priced in yet. Every call carries its evidence.
            </p>

            <RequireAuth>
              <form onSubmit={run} className="app-query-box mt-9">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label htmlFor="intent" className="label-mono text-muted-foreground">
                    Name a ticker or describe the exposure
                  </label>
                </div>
                <textarea
                  id="intent"
                  rows={4}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  readOnly={submitting}
                  aria-readonly={submitting}
                  placeholder="e.g. Watch NVDA: what events could move it before price reflects them?"
                  className="mt-3 w-full"
                />
                <div className="app-query-meta">
                  <p aria-live="polite">
                    {submitting ? "Sending your request…" : "One request. Sourced, graded, cited."}
                  </p>
                  <button
                    type="submit"
                    className="app-signal-button shrink-0 inline-flex items-center gap-2"
                    disabled={submitting || !query.trim()}
                  >
                    {submitting ? (
                      <>
                        <span
                          className="inline-block size-3 animate-spin rounded-full border-2 border-ink/40 border-t-ink"
                          aria-hidden
                        />
                        Sending…
                      </>
                    ) : (
                      "Run intelligence"
                    )}
                  </button>
                </div>
              </form>
            </RequireAuth>

            <div className="mt-3 flex flex-wrap gap-2">
              {EXAMPLES.filter((ex) => ex !== query).map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setQuery(example)}
                  className="app-filter-button text-left normal-case tracking-normal"
                >
                  {example.length > 90 ? `${example.slice(0, 88)}…` : example}
                </button>
              ))}
            </div>
          </div>
        </section>
      ) : (
        <section className="border-b border-border bg-[#0a0f0e]/95 backdrop-blur">
          <div className="mx-auto max-w-[1280px] px-6 py-4 sm:px-8 sm:py-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="label-mono flex items-center gap-2 text-signal">
                <span className="app-sync-dot" aria-hidden />
                {phase === "running"
                  ? inquiry?.status === "grading"
                    ? "Checking the evidence…"
                    : inquiry?.status === "dispatching"
                      ? "Opening the investigation…"
                      : "Watching the tape…"
                  : phase === "done"
                    ? "Readout ready"
                    : "Run failed"}
              </p>
              <button
                type="button"
                onClick={() => {
                  if (pollRef.current) window.clearInterval(pollRef.current);
                  try { sessionStorage.setItem("prime-layer:dismissed", "1"); } catch {}
                  setPhase("idle");
                  setInquiry(null);
                }}
                className="rounded-sm border border-white/20 bg-white/5 px-3.5 py-1.5 text-xs font-medium text-vellum hover:border-signal hover:text-signal hover:bg-white/10"
              >
                New request
              </button>
            </div>
            {inquiry?.question && (
                <p className="mt-3 max-w-3xl truncate font-mono text-xs leading-relaxed text-ink-muted">
                “{inquiry.question}”
              </p>
            )}
          </div>
        </section>
      )}

      {phase === "idle" && (
        <div className="app-content">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.56fr)]">
            <section className="surface p-5 sm:p-7" aria-labelledby="request-shape">
              <SectionHeading
                eyebrow="How the watch is handled"
                title="A ticker in. An impact thesis underneath."
              />
              <div className="mt-7 grid gap-5 sm:grid-cols-3">
                <div className="border-t-2 border-signal pt-3">
                  <p className="label-mono text-signal">01 · Intent</p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    StockIntel maps the ticker, sector and exposure question.
                  </p>
                </div>
                <div className="border-t-2 border-signal pt-3">
                  <p className="label-mono text-signal">02 · Dispatch</p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    Your watch fans out across every surface at once.
                  </p>
                </div>
                <div className="border-t-2 border-signal pt-3">
                  <p className="label-mono text-signal">03 · Readout</p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    Claims are graded after clustering. The thesis returns with its evidence.
                  </p>
                </div>
              </div>
              <div className="mt-8 border-t border-border pt-5">
                <p className="label-mono text-muted-foreground">How your request is handled</p>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed">
                  StockIntel watches your ticker across every surface, verifies what comes back, and returns the events worth your attention,
                  each with the evidence behind it.
                </p>
              </div>
            </section>

            <aside className="surface-dark p-5 sm:p-6" aria-labelledby="dispatch-model">
              <SectionHeading
                dark
                eyebrow="On-demand dispatch"
                title="The right coverage for the open question"
                action={<Bot className="size-5 text-signal" aria-hidden />}
              />
              <div className="mt-7 space-y-5">
                <div className="flex gap-3">
                  <Database className="mt-0.5 size-4 shrink-0 text-signal" aria-hidden />
                  <p className="text-sm leading-relaxed text-ink-muted">
                    Work starts only when you ask. Minutes to source, then submit.
                  </p>
                </div>
                <div className="flex gap-3">
                  <Layers3 className="mt-0.5 size-4 shrink-0 text-signal" aria-hidden />
                  <p className="text-sm leading-relaxed text-ink-muted">
                    Duplicate citations collapse into one source. Independence is what earns confidence.
                  </p>
                </div>
                <div className="flex gap-3">
                  <ScanLine className="mt-0.5 size-4 shrink-0 text-signal" aria-hidden />
                  <p className="text-sm leading-relaxed text-ink-muted">
                    The output is an impact assessment, not a price target or a hot tip.
                  </p>
                </div>
              </div>
            </aside>
          </div>
        </div>
      )}

      {phase !== "idle" && (
        <div className="app-content">
          <div className="grid gap-8 xl:grid-cols-[minmax(18rem,0.6fr)_minmax(0,1.4fr)]">
            <section className="surface-dark p-5 sm:p-6" aria-label="System operations">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="label-mono text-signal">System operations</p>
                  <h2 className="mt-2 font-display text-2xl text-vellum">The readout in motion</h2>
                </div>
                <span className="app-sync-dot mt-1" aria-hidden />
              </div>
              <ol className="mt-7">
                {steps.map((step, index) => {
                  const state =
                    step.state === "done" ? "done" : step.state === "active" ? "active" : "idle";
                  const isCurrent = steps.findIndex((s) => s.state === "active") === index;
                  return (
                    <li key={step.label} className="app-system-step" data-state={state}>
                      <p className="app-system-step-label">{step.label}</p>
                      <ul className="app-system-step-lines">
                        {(state !== "idle" || isCurrent) &&
                          step.lines.map((line) => <li key={line}>{line}</li>)}
                      </ul>
                    </li>
                  );
                })}
              </ol>
              <p className="mt-7 border-t border-ink-border pt-4 font-mono text-[0.66rem] leading-relaxed text-ink-muted">
                One readout. Every claim carries its source.
              </p>
            </section>

            <section aria-label="Ranked results">
              <div className="flex flex-wrap items-baseline justify-between gap-4">
                <div>
                  <h2 className="mt-2 font-display text-2xl">What came back</h2>
                </div>
                <div className="flex items-center gap-3">
                  {phase === "done" && <StatusPill tone="verified" label="Evidence attached" />}
                  {phase === "failed" && <StatusPill tone="flagged" label="Run failed" />}
                </div>
              </div>

              {phase === "done" && report ? (
                /* The intelligence report is the deliverable. Everything below
                   this branch is the older per-exposure thesis, kept only for
                   runs recorded before the report pass existed. */
                <div className="mt-5">
                  <ReportView
                    report={report}
                    marketSlot={<AgentOsConnect identity={identity} />}
                  />
                </div>
              ) : phase === "done" && synthesis && synthesis.recommendations.length > 0 ? (
                <div className="mt-5 space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-500">
                  <p className="font-mono text-xs text-muted-foreground">
                    This run predates the intelligence report, so what follows is the older
                    per-exposure thesis.
                  </p>
                  {synthesis.preamble && (
                    <p className="max-w-3xl border-l-2 border-signal pl-4 text-sm leading-relaxed text-muted-foreground">
                      {synthesis.preamble}
                    </p>
                  )}
                  {synthesis.market && synthesis.market.lines.length > 0 && (
                    <div className="surface-dark p-5 sm:p-6" aria-label="Agent OS market check">
                      <p className="label-mono text-signal">Agent OS market check · {synthesis.market.source === "agent-os" ? "live via Agent OS" : "live via public mirror"}</p>
                      <div className="mt-2">
                        <AgentOsConnect identity={identity} />
                      </div>
                      <ul className="mt-3 space-y-1.5 font-mono text-xs leading-relaxed text-ink-muted">
                        {synthesis.market.lines.slice(0, 8).map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <ol className="space-y-4">
                    {synthesis.recommendations.map((rec, index) => {
                      const verdict = (rec as { verdict?: string }).verdict ?? "unclear";
                      const marketCall = (rec as { marketCall?: string }).marketCall ?? "";
                      const timeframe = (rec as { timeframe?: string }).timeframe ?? "";
                      const marketLines = (rec as { marketLines?: string[] }).marketLines ?? [];
                      const verdictLabel =
                        verdict === "priced"
                          ? "Priced in · no edge"
                          : verdict === "underpriced"
                            ? "Not yet priced"
                            : "Unclear";
                      return (
                      <li key={`${rec.company}-${index}`} className="surface p-5 sm:p-6">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="min-w-0">
                            <p className="label-mono text-signal">
                              {String(index + 1).padStart(2, "0")} · Assessment · {verdictLabel}
                            </p>
                            <h3 className="mt-2 font-display text-2xl leading-tight">
                              {rec.company}
                            </h3>
                            {rec.title && rec.title !== rec.company && (
                              <p className="mt-1 text-sm font-medium">{rec.title}</p>
                            )}
                          </div>
                          <div className="text-right">
                            <p className="font-mono text-3xl text-signal">{rec.confidence}%</p>
                            <p className="label-mono text-muted-foreground">confidence</p>
                          </div>
                        </div>
                        <p className="mt-4 max-w-3xl text-sm leading-relaxed">{rec.body}</p>
                        {(marketCall || timeframe) && (
                          <div className="mt-4 rounded-sm border border-border bg-slate/20 p-4" aria-label="Market call">
                            {marketCall && (
                              <p className="text-sm leading-relaxed">
                                <span className="label-mono text-signal">Market call · </span>
                                {marketCall}
                              </p>
                            )}
                            {timeframe && (
                              <p className="mt-2 font-mono text-xs text-muted-foreground">
                                TIMEFRAME {timeframe}
                              </p>
                            )}
                            {marketLines.length > 0 && (
                              <ul className="mt-2 space-y-1 font-mono text-xs text-muted-foreground">
                                {marketLines.slice(0, 4).map((line) => (
                                  <li key={line}>{line}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                        {rec.sources.length > 0 && (
                          <div className="mt-5 border-t border-border pt-4">
                            <ul className="flex flex-wrap gap-2">
                              {rec.sources.map((source, sIndex) => (
                                <li key={`${source.url}-${sIndex}`}>
                                  <a
                                    href={source.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    title={source.url}
                                    className="inline-flex max-w-[220px] items-center gap-1.5 rounded-sm border border-border px-2.5 py-1.5 font-mono text-xs text-signal hover:border-signal hover:bg-slate/30"
                                  >
                                    <span className="truncate">{source.label || source.url}</span>
                                    <ArrowUpRight className="size-3 shrink-0" aria-hidden />
                                  </a>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </li>
                      );
                    })}
                  </ol>
                </div>
              ) : phase === "done" && synthesis ? (
                <div className="surface mt-5 p-8 text-center animate-in fade-in slide-in-from-bottom-2 duration-500">
                  <p className="font-display text-xl">
                    Honestly, nothing worth recommending came back.
                  </p>
                  <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
                    {synthesis.preamble ||
                      "We looked everywhere and, honestly, nothing solid came back. That usually means no fresh event is forming around this ticker right now, not that something broke. Try another ticker, or check back soon."}
                  </p>
                </div>
              ) : phase === "done" && readout.length > 0 ? (
                <div className="surface mt-5 p-8 text-center animate-in fade-in duration-500">
                  <p className="label-mono text-signal">Composing your thesis</p>
                  <p className="mt-3 font-display text-2xl">
                    Evidence graded. Writing the readout.
                  </p>
                  <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
                    {readout.length} companies ranked from {inquiry?.sourcesClustered ?? 0} source
                    clusters. StockIntel is now writing the causal chain behind each one.
                    This usually takes under a minute.
                  </p>
                  <div className="mx-auto mt-6 max-w-md space-y-2" aria-hidden>
                    <div className="h-3 w-3/4 mx-auto animate-pulse rounded bg-border" />
                    <div className="h-3 w-1/2 mx-auto animate-pulse rounded bg-border" />
                  </div>
                </div>
              ) : phase === "done" ? (
                <div className="surface mt-5 p-8 text-center animate-in fade-in slide-in-from-bottom-2 duration-500">
                  <p className="font-display text-xl">Nothing came back this time.</p>
                  <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
                    We looked everywhere and, honestly, nothing solid came back.
                    That usually means no fresh event is forming around this ticker right now, not that
                    something broke. Try another ticker, or check back soon. The moment something moves,
                    it'll show up here.
                  </p>
                </div>
              ) : phase === "running" ? (
                <div className="mt-5 space-y-4">
                  <div className="surface p-5 sm:p-6">
                    <p className="label-mono text-signal">Watching the tape…</p>
                    <h3 className="mt-2 font-display text-xl">Your watch is live. Give us a moment.</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      Your watch is live across every surface. An in-depth investigation
                      typically takes about 5 minutes: sourcing, then clustering, then
                      grading, then your readout. Patience here is part of the product.
                      The readout appears the moment grading finishes.
                    </p>
                    <div className="mt-5 border-t border-border pt-4">
                      <p className="label-mono text-muted-foreground">While you wait</p>
                      <RotatingFacts />
                    </div>
                    <p className="mt-4 font-mono text-[0.65rem] text-ink-muted">
                      Tip: you can switch tabs. We keep polling and will show the readout when it lands.
                    </p>
                  </div>
                  <SourcingCountdown
                    deadlineIso={inquiry?.windowClosesAt ?? null}
                    windowSeconds={inquiry?.windowSeconds ?? 300}
                    grading={inquiry?.status === "grading"}
                    claims={inquiry?.claimsReceived ?? 0}
                    sources={inquiry?.sourcesClustered ?? 0}
                  />
                </div>
              ) : phase === "failed" ? (
                <div className="surface mt-5 p-8 text-center animate-in fade-in duration-300">
                  <p className="font-display text-xl">Run failed</p>
                  <p className="mx-auto mt-3 max-w-md font-mono text-xs leading-relaxed text-muted-foreground">
                    {inquiry?.error ?? "Something went wrong on our end."}
                  </p>
                  {identity ? (
                    <p className="mt-2 font-mono text-[0.65rem] text-signal">
                      1 free retry added. Try again whenever you are ready.
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="mt-5 space-y-3">
                  <div className="h-24 rounded-sm border border-border bg-slate/30 animate-pulse" />
                  <div className="h-24 rounded-sm border border-border bg-slate/20 animate-pulse [animation-delay:150ms]" />
                  <div className="h-24 rounded-sm border border-border bg-slate/10 animate-pulse [animation-delay:300ms]" />
                  <p className="pt-2 text-center font-mono text-[0.65rem] text-ink-muted">
                    Watching. Results slide in as soon as the signals are ranked
                  </p>
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

type LiveStep = { label: string; lines: string[]; state: "idle" | "active" | "done" };

function buildSteps(inquiry: InquiryState | null): LiveStep[] {
  const status = inquiry?.status ?? "dispatching";
  const order = ["dispatching", "collecting", "grading", "complete"];
  const reached = (stage: string) => order.indexOf(status) >= order.indexOf(stage);

  return [
    {
      label: "Mapping exposure",
      state: "done",
      lines: [
        ...(inquiry?.category ? [inquiry.category] : []),
        ...(inquiry?.geography ? [inquiry.geography] : []),
      ],
    },
    {
      label: "Fanning out",
      state: reached("collecting") ? "done" : reached("dispatching") ? "active" : "idle",
      lines: [
        `Sourcing window · ${inquiry?.windowSeconds ?? 300}s`,
        "Every surface around the ticker is investigated at once",
      ],
    },
    {
      label: "Evidence in",
      state: reached("grading") ? "done" : reached("collecting") ? "active" : "idle",
      lines: [
        `${inquiry?.claimsReceived ?? 0} claims submitted`,
        `${inquiry?.sourcesClustered ?? 0} independent source clusters`,
      ],
    },
    {
      label: "Ranking impact",
      state: status === "complete" ? "done" : reached("grading") ? "active" : "idle",
      lines:
        status === "complete"
          ? [`${((inquiry?.readout as ReadoutEntry[] | null) ?? []).length} assessments in readout`]
          : ["Weighting by independence and reliability"],
    },
  ];
}
