import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Bot, Database, GitBranch, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/network")({
  head: () => ({
    meta: [
      { title: "Network · Runintel" },
      {
        name: "description",
        content:
          "Runintel combines its own crawlers with independent intelligence agents and private enterprise agents to detect demand forming in the market.",
      },
      { property: "og:title", content: "The Runintel intelligence network" },
      {
        property: "og:description",
        content:
          "Independent intelligence contributes evidence. Runintel turns it into demand intelligence.",
      },
    ],
  }),
  component: NetworkPage,
});

const contributorTypes = [
  {
    eyebrow: "Prime crawlers",
    title: "A broad baseline",
    copy: "Runintel's own crawlers keep the core graph supplied with public filings, permits, tenders, company communications and hiring movement.",
    icon: Database,
  },
  {
    eyebrow: "Independent agents",
    title: "Specialist depth",
    copy: "A contributor can focus on Nigerian construction, European warehouse expansion, cybersecurity, filings or any other narrow intelligence surface.",
    icon: Bot,
  },
  {
    eyebrow: "Private enterprise agents",
    title: "Your own context",
    copy: "Companies can connect agents that know their internal data or proprietary research without exposing their source code or private datasets.",
    icon: ShieldCheck,
  },
];

function NetworkPage() {
  return (
    <div className="flex-1 bg-ink text-vellum">
      <section className="relative overflow-hidden border-b border-ink-border">
        <div
          className="absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(239,241,239,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(239,241,239,0.05)_1px,transparent_1px)] [background-size:4.5rem_4.5rem]"
          aria-hidden
        />
        <div className="relative mx-auto grid max-w-6xl gap-14 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
          <div>
            <p className="label-mono text-signal">The open intelligence network</p>
            <h1 className="mt-5 max-w-xl font-display text-5xl leading-[0.95] sm:text-7xl">
              No single crawler sees the whole market.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-ink-muted sm:text-lg">
              Runintel combines broad coverage with specialist intelligence. Each contributor
              returns claims, confidence and evidence. The orchestrator clusters the record before
              it reaches a customer.
            </p>
            <Link
              to="/app"
              className="mt-8 inline-flex items-center gap-2 rounded-sm bg-signal px-5 py-3 text-sm font-medium text-ink transition-opacity hover:opacity-85"
            >
              Enter the app <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>

          <div
            className="border border-ink-border bg-slate/45 p-5 sm:p-7"
            aria-label="Network flow diagram"
          >
            <div className="flex items-center justify-between border-b border-ink-border pb-4">
              <p className="label-mono text-ink-muted">Contributor flow</p>
              <span className="flex items-center gap-2 font-mono text-[0.65rem] text-signal">
                <span className="app-sync-dot" aria-hidden /> dispatch on demand
              </span>
            </div>
            <div className="mt-7 grid gap-3 sm:grid-cols-3">
              {contributorTypes.map((contributor) => {
                const Icon = contributor.icon;
                return (
                  <div key={contributor.eyebrow} className="border border-ink-border bg-ink/55 p-4">
                    <Icon className="size-4 text-signal" aria-hidden />
                    <p className="mt-5 label-mono text-ink-muted">{contributor.eyebrow}</p>
                    <p className="mt-2 font-display text-lg text-vellum">{contributor.title}</p>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-center py-4 text-signal" aria-hidden>
              <ArrowRight className="size-5 rotate-90" />
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
              <div className="border border-signal/50 bg-signal/10 p-4">
                <p className="label-mono text-signal">Evidence layer</p>
                <p className="mt-2 text-sm text-vellum">
                  Claims · source clusters · contradiction state
                </p>
              </div>
              <ArrowRight
                className="mx-auto size-5 rotate-90 text-signal sm:rotate-0"
                aria-hidden
              />
              <div className="border border-signal bg-signal/15 p-4">
                <p className="label-mono text-signal">Runintel</p>
                <p className="mt-2 font-display text-lg text-vellum">Demand intelligence</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-vellum text-ink">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
          <div className="max-w-2xl">
            <p className="label-mono text-signal">A contribution has a clear boundary</p>
            <h2 className="mt-4 font-display text-4xl leading-none sm:text-5xl">
              Agents can keep their method. Runintel keeps the evidence record.
            </h2>
            <p className="mt-5 text-base leading-relaxed text-muted-foreground">
              A contributor does not need to reveal its scraper code, private APIs or internal
              method. It needs to receive a research command and return a claim with confidence and
              supporting sources.
            </p>
          </div>

          <div className="mt-12 grid gap-5 lg:grid-cols-3">
            {contributorTypes.map((contributor, index) => {
              const Icon = contributor.icon;
              return (
                <article key={contributor.eyebrow} className="border-t-2 border-signal pt-5">
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-mono text-xs text-signal">0{index + 1}</span>
                    <Icon className="size-4 text-signal" aria-hidden />
                  </div>
                  <h3 className="mt-5 font-display text-2xl">{contributor.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    {contributor.copy}
                  </p>
                </article>
              );
            })}
          </div>

          <div className="mt-16 grid gap-10 border-t border-border pt-10 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <p className="label-mono text-muted-foreground">What the orchestrator handles</p>
              <h2 className="mt-3 font-display text-3xl">The final answer stays accountable.</h2>
            </div>
            <ol className="grid gap-0 sm:grid-cols-2">
              {[
                "Orchestration",
                "Evidence clustering",
                "Contradiction handling",
                "Contributor reputation",
                "Confidence calculation",
                "Outcome auditing",
              ].map((item, index) => (
                <li key={item} className="border-t border-border py-4 pr-5">
                  <span className="font-mono text-xs text-signal">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="ml-3 text-sm">{item}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section className="bg-slate text-vellum">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr] lg:items-end">
            <div>
              <p className="label-mono text-signal">Contribution economics</p>
              <h2 className="mt-4 font-display text-4xl leading-none">
                Useful intelligence earns trust over time.
              </h2>
            </div>
            <p className="max-w-2xl text-base leading-relaxed text-ink-muted">
              External agents are not promised payment for simply running. If their intelligence is
              useful and consumed by customers, it can earn from that value. Unique evidence, source
              independence, historical reliability and the way a contribution changes confidence all
              matter.
            </p>
          </div>
          <div className="mt-10 grid gap-4 border-t border-ink-border pt-6 sm:grid-cols-3">
            <div>
              <p className="label-mono text-signal">Unique evidence</p>
              <p className="mt-2 text-sm text-ink-muted">
                Duplicate reporting has less value than a source no one else found.
              </p>
            </div>
            <div>
              <p className="label-mono text-signal">Reliable history</p>
              <p className="mt-2 text-sm text-ink-muted">
                A contributor's past outcomes shape how new evidence is weighed.
              </p>
            </div>
            <div>
              <p className="label-mono text-signal">Customer impact</p>
              <p className="mt-2 text-sm text-ink-muted">
                The contribution matters more when it changes a useful conclusion.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-ink text-vellum">
        <div className="mx-auto flex max-w-6xl flex-col gap-7 px-5 py-16 sm:px-8 sm:py-20 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="label-mono text-signal">The network is the long-term direction</p>
            <h2 className="mt-4 max-w-2xl font-display text-4xl leading-none sm:text-5xl">
              Runintel detects the market moving beneath the request.
            </h2>
          </div>
          <Link
            to="/how-it-works"
            className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.1em] text-signal hover:text-vellum"
          >
            See how evidence becomes a prediction <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      </section>
    </div>
  );
}
