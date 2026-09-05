import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, Boxes, CheckCircle2, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/app/AppShell";
import { PrivyIdentity, type PrivyIdentityInfo } from "@/components/app/privy-identity";
import { MetricBlock, SectionHeading } from "@/components/app/AppUI";
import { listSupplyLive, type SupplyView } from "@/lib/orchestrator/workspace";
import { getMarketQuotes } from "@/lib/binance/fns";
import { extractTicker } from "@/lib/binance/market";
import { addSupplyRecord } from "@/lib/orchestrator/fns";
import { RequireAuth, RequireAuthAction } from "@/components/app/auth-gate";

export const Route = createFileRoute("/app/supply")({
  head: () => ({
    meta: [
      { title: "Watchlist · StockIntel workspace" },
      {
        name: "description",
        content:
          "Define the tickers you hold so StockIntel can rank freshly detected events against your positions, sectors and exposures.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Supply,
});

function Supply() {
  const [privy, setPrivy] = useState<PrivyIdentityInfo>({
    authenticated: false,
    email: null,
    walletAddress: null,
    firstWallet: null,
  });
  const identity = privy.email ?? privy.walletAddress ?? null;
  const [records, setRecords] = useState<SupplyView[] | null>(null);
  const [quotes, setQuotes] = useState<
    Record<string, { symbol: string | null; price: number | null; change24hPct: number | null }>
  >({});
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [market, setMarket] = useState("US equities");
  const [target, setTarget] = useState("Semiconductors");
  const [capacity, setCapacity] = useState("");

  useEffect(() => {
    if (!identity) {
      setRecords([]);
      return;
    }
    void listSupplyLive({ data: { identity } }).then((rows) => {
      setRecords(rows);
      const tickers = Array.from(
        new Set(rows.map((r) => extractTicker(r.name)).filter(Boolean)),
      );
      if (tickers.length === 0) return;
      void getMarketQuotes({ data: { tickers } }).then((qs) => {
        const map: Record<string, { symbol: string | null; price: number | null; change24hPct: number | null }> = {};
        for (const q of qs) map[q.ticker] = { symbol: q.symbol, price: q.price, change24hPct: q.change24hPct };
        setQuotes(map);
      });
    });
  }, [identity]);

  async function addRecord(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || !capacity.trim() || saving) return;
    setSaving(true);
    try {
      await addSupplyRecord({
        data: {
          name: `${name.trim()} (${capacity.trim()})`,
          markets: [market],
          targets: [target.trim()],
          ...(identity ? { identity } : {}),
        },
      });
      setName("");
      setCapacity("");
      setAdding(false);
      setRecords(await listSupplyLive({ data: { ...(identity ? { identity } : {}) } }));
    } finally {
      setSaving(false);
    }
  }

  const view = records ?? [];

  return (
    <div>
      <PrivyIdentity onChange={setPrivy} />
      <PageHeader
        eyebrow="Watchlist"
        title="Tickers under watch"
        intro="This is not a public portfolio. It is the private reference StockIntel uses to rank freshly detected events against what you hold: positions, sectors and the exposures you care about."
      >
        <RequireAuthAction signInLabel="Sign in to add tickers">
          <button
            type="button"
            className="app-dark-button shrink-0"
            onClick={() => setAdding((value) => !value)}
          >
            {adding ? (
              <X className="size-4" aria-hidden />
            ) : (
              <Plus className="size-4" aria-hidden />
            )}
            {adding ? "Close form" : "Add watch entry"}
          </button>
        </RequireAuthAction>
      </PageHeader>

      <div className="app-content">
        {adding && (
          <RequireAuth>
            <section className="surface-dark mb-8 p-5 sm:p-6" aria-labelledby="add-supply">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="label-mono text-signal">New watch entry</p>
                  <h2 className="mt-2 font-display text-2xl text-vellum">
                    Give the graph something concrete to watch
                  </h2>
                </div>
                <Boxes className="size-5 text-signal" aria-hidden />
              </div>
              <form onSubmit={addRecord} className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <label>
                  <span className="app-form-label text-ink-muted">Ticker / position</span>
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                    className="app-input mt-2 border-ink-border bg-slate text-vellum placeholder:text-ink-subtle"
                    placeholder="e.g. NVDA, 200 shares"
                  />
                </label>
                <label>
                  <span className="app-form-label text-ink-muted">Position / thesis</span>
                  <input
                    value={capacity}
                    onChange={(event) => setCapacity(event.target.value)}
                    required
                    className="app-input mt-2 border-ink-border bg-slate text-vellum placeholder:text-ink-subtle"
                    placeholder="e.g. long AI infra"
                  />
                </label>
                <label>
                  <span className="app-form-label text-ink-muted">Primary market</span>
                  <select
                    value={market}
                    onChange={(event) => setMarket(event.target.value)}
                    className="app-select mt-2 border-ink-border bg-slate text-vellum"
                  >
                    <option>US equities</option>
                    <option>bStocks 24/7</option>
                    <option>Crypto</option>
                    <option>All markets</option>
                  </select>
                </label>
                <label>
                  <span className="app-form-label text-ink-muted">Target exposure</span>
                  <input
                    value={target}
                    onChange={(event) => setTarget(event.target.value)}
                    required
                    className="app-input mt-2 border-ink-border bg-slate text-vellum placeholder:text-ink-subtle"
                    placeholder="e.g. Semiconductors"
                  />
                </label>
                <div className="sm:col-span-2 lg:col-span-4">
                  <button type="submit" className="app-signal-button">
                    Save to watchlist <ArrowUpRight className="size-3.5" aria-hidden />
                  </button>
                  <p className="mt-3 font-mono text-[0.64rem] text-ink-muted">
                    Saved to your workspace and matched against fresh events on the graph.
                  </p>
                </div>
              </form>
            </section>
          </RequireAuth>
        )}

        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <SectionHeading eyebrow="Watch context" title="Your side of the graph" />
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              StockIntel uses these entries to rank fresh events against what you hold.
              The match stays private to your workspace.
            </p>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <CheckCircle2 className="size-4 text-verified" aria-hidden />
            <span className="font-mono text-xs">{view.length} records active</span>
          </div>
        </div>

        <ul className="mt-6 grid gap-4 lg:grid-cols-2">
          {records === null && (
            <li className="surface p-8 text-center text-sm text-muted-foreground">
              Loading watchlist…
            </li>
          )}
          {records !== null && view.length === 0 && (
            <li className="surface p-8 text-center text-sm text-muted-foreground">
              {!identity ? (
                <>Sign in to see your watchlist. Entries belong to the workspace that saved them.</>
              ) : (
                <>
                  No entries yet. Add a ticker and StockIntel matches fresh events against
                  it.
                </>
              )}
            </li>
          )}
          {view.map((record, index) => (
            <li
              key={record.id}
              className={`surface overflow-hidden ${index === 0 ? "border-signal/50" : ""}`}
            >
              <div className="border-l-2 border-signal p-5 sm:p-6">
                <div className="flex items-start justify-between gap-5">
                  <div>
                      <p className="label-mono text-muted-foreground">
                        Watch entry · {String(index + 1).padStart(2, "0")}
                      </p>
                    <h2 className="mt-2 font-display text-2xl leading-none">{record.name}</h2>
                    <p className="mt-2 font-mono text-xs text-muted-foreground">
                      {record.markets.join(" / ")} · {record.targets.join(" / ")}
                    </p>
                    {(() => {
                      const q = quotes[extractTicker(record.name)];
                      if (!q) return null;
                      if (q.symbol === null || q.price === null) {
                        return (
                          <p className="mt-1 font-mono text-xs text-muted-foreground">
                            no Binance listing
                          </p>
                        );
                      }
                      const up = (q.change24hPct ?? 0) >= 0;
                      const pct = Math.abs(q.change24hPct ?? 0).toFixed(2);
                      return (
                        <p className="mt-1 font-mono text-xs">
                          <span className="text-muted-foreground">{q.symbol} · </span>
                          <span className="text-ink">
                            ${q.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>{" "}
                          <span className={up ? "text-verified" : "text-flag"}>
                            ({up ? "+" : "-"}{pct}%)
                          </span>
                        </p>
                      );
                    })()}
                  </div>
                  <Boxes className="size-5 shrink-0 text-signal" aria-hidden />
                </div>

                <div className="mt-6 grid grid-cols-2 gap-4 border-t border-border pt-5">
                  {record.detail.map((detail) => (
                    <MetricBlock key={detail.label} label={detail.label} value={detail.value} />
                  ))}
                    <MetricBlock label="Markets" value={record.markets.join(" / ")} />
                    <MetricBlock label="Target exposure" value={record.targets.join(" / ")} />
                </div>

                <div className="mt-6 grid grid-cols-2 gap-4 border-t border-border pt-5">
                  <div>
                    <p className="label-mono text-muted-foreground">Current matches</p>
                    <p className="mt-2 font-mono text-2xl text-signal">{record.matches}</p>
                  </div>
                  <div>
                    <p className="label-mono text-muted-foreground">High confidence</p>
                    <p className="mt-2 font-mono text-2xl text-verified">{record.highConfidence}</p>
                  </div>
                </div>

                <Link
                  to="/app"
                  className="mt-6 inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.1em] text-signal hover:text-ink"
                >
                  Run a watch against this entry <ArrowUpRight className="size-3.5" aria-hidden />
                </Link>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-8 grid gap-5 border-t border-border pt-6 md:grid-cols-3">
          <div>
            <p className="label-mono text-muted-foreground">Private by default</p>
            <p className="mt-2 text-sm leading-relaxed">
              Watch entries help rank your assessments and are not public portfolios.
            </p>
          </div>
          <div>
            <p className="label-mono text-muted-foreground">Matched to movement</p>
            <p className="mt-2 text-sm leading-relaxed">
              A ticker becomes interesting when a fresh event touches its exposure.
            </p>
          </div>
          <div>
            <p className="label-mono text-muted-foreground">No static profiles</p>
            <p className="mt-2 text-sm leading-relaxed">
              The graph cares about exposure, timing and the reason a move could form.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
