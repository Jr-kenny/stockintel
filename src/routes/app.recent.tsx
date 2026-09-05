import { createFileRoute } from "@tanstack/react-router";
import { ArrowUpRight, Clock, History } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/app/AppShell";
import { PrivyIdentity, type PrivyIdentityInfo } from "@/components/app/privy-identity";
import { listMyRuns } from "@/lib/orchestrator/fns";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

export const Route = createFileRoute("/app/recent")({
  head: () => ({
    meta: [
      { title: "Recent runs · StockIntel workspace" },
      {
        name: "description",
        content: "Your past intelligence runs.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Recent,
});

function Recent() {
  const [privy, setPrivy] = useState<PrivyIdentityInfo>({
    authenticated: false,
    email: null,
    walletAddress: null,
    firstWallet: null,
  });
  const identity = privy.email ?? privy.walletAddress ?? null;
  const [history, setHistory] = useState<Awaited<ReturnType<typeof listMyRuns>>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!identity) {
      setHistory([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    void listMyRuns({ data: { identity } })
      .then((rows) => {
        // Hide failed runs. They will be compensated, not shown as clutter.
        const filtered = rows.filter((r) => r.complete);
        setHistory(filtered);
      })
      .finally(() => setLoading(false));
  }, [identity]);

  return (
    <div>
      <PageHeader eyebrow="Workspace" title="Recent runs" />
      <PrivyIdentity onChange={setPrivy} />

      <div className="app-content">
        <section className="surface p-5 sm:p-6" aria-labelledby="recent-list">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <History className="size-5 text-signal" aria-hidden />
              <div>
                <h2 id="recent-list" className="font-display text-xl">
                  Your past intelligence
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {identity
                    ? loading
                      ? "Loading…"
                      : history.length === 0
                        ? "No successful runs yet"
                        : `${history.length} successful run${history.length === 1 ? "" : "s"}. Most recent first`
                    : "Sign in to see your workspace history"}
                </p>
              </div>
            </div>
            <span className="label-mono text-ink-muted">
              <Clock className="mr-1.5 inline size-3" aria-hidden />
              newest first
            </span>
          </div>

          <div className="mt-6">
            {!identity ? (
              <p className="rounded-sm border border-dashed border-border p-8 text-center text-sm leading-relaxed text-muted-foreground">
                Sign in to see past enquiries.
              </p>
            ) : loading ? (
              <div className="space-y-3">
                <div className="h-16 animate-pulse rounded-sm border border-border bg-slate/20" />
                <div className="h-16 animate-pulse rounded-sm border border-border bg-slate/10" />
                <div className="h-16 animate-pulse rounded-sm border border-border bg-slate/5" />
              </div>
            ) : history.length === 0 ? (
              <p className="rounded-sm border border-border p-8 text-center text-sm leading-relaxed text-muted-foreground">
                No runs yet. Start one from{" "}
                <a href="/app" className="text-signal underline underline-offset-4">
                  Intelligence
                </a>
                .
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-sm border border-border">
                {history.map((row) => (
                  <li key={row.id} className="group">
                    <HoverCard>
                      <HoverCardTrigger asChild>
                        <button
                          type="button"
                          onClick={() => {
                            window.location.href = `/app?inquiry=${row.id}`;
                          }}
                          className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left transition-colors hover:bg-slate/30"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium leading-snug text-vellum group-hover:text-signal">
                              {row.question}
                            </span>
                            <span className="mt-1 block font-mono text-[0.65rem] leading-relaxed text-ink-muted">
                              {row.createdAt ? new Date(row.createdAt).toLocaleString() : ""}
                              {row.sourcesClustered > 0
                                ? ` · ${row.sourcesClustered} independent source${row.sourcesClustered === 1 ? "" : "s"}`
                                : ""}
                              {row.claimsReceived > 0
                                ? ` · ${row.claimsReceived} signal${row.claimsReceived === 1 ? "" : "s"}`
                                : ""}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-1.5 rounded-sm bg-verified/10 px-2.5 py-1.5 font-mono text-[0.65rem] text-verified">
                            view
                            <ArrowUpRight className="size-3" />
                          </span>
                        </button>
                      </HoverCardTrigger>
                      <HoverCardContent className="w-80 p-3" align="start">
                        <p className="line-clamp-3 text-sm leading-relaxed">{row.question}</p>
                        <p className="mt-2 font-mono text-[0.65rem] text-ink-muted">
                          {row.createdAt ? new Date(row.createdAt).toLocaleString() : ""}
                        </p>
                        {row.sourcesClustered > 0 && (
                          <p className="mt-1 font-mono text-[0.65rem] text-ink-muted">
                            {row.sourcesClustered} sources · {row.claimsReceived} signals
                          </p>
                        )}
                      </HoverCardContent>
                    </HoverCard>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
