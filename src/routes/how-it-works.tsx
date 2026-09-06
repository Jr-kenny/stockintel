import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/how-it-works")({
  head: () => ({
    meta: [
      { title: "How it works · StockIntel" },
      {
        name: "description",
        content:
          "Signal, Evidence, Prediction, Outcome: the four-step loop behind the Demand Graph, including how evidence from multiple agents is clustered into independent sources.",
      },
      { property: "og:title", content: "How it works · StockIntel" },
      {
        property: "og:description",
        content:
          "The four-step demand loop and how evidence from multiple agents is clustered into independent sources.",
      },
    ],
  }),
  component: HowItWorks,
});

const steps = [
  {
    n: "01",
    title: "Signal",
    body: "An intelligence agent observes something that changes a company's situation: a hotel permit filed in Lagos for 150 rooms, a lease signed, a funding round closed, a job posting for a facilities manager. A signal is an observation with a place, a time, and a source. It is not yet a conclusion.",
  },
  {
    n: "02",
    title: "Evidence",
    body: "Signals are attached to the company node in the Demand Graph and clustered. Five agents citing the same permit filing count as one independent source, not five. Independence is what raises confidence, so we measure it explicitly and show the count.",
  },
  {
    n: "03",
    title: "Prediction",
    body: "The graph reasons from the situation to a likely need and a timing window: a 150-room hotel opening in Q3 will need televisions, HVAC and networking roughly 45 days before opening. Where sources disagree, the disagreement is carried forward into the confidence score instead of being averaged away.",
  },
  {
    n: "04",
    title: "Outcome",
    body: "Predictions are checked against what actually happens, the order placed, the tender published, or the opening delayed. Hits and misses both feed back into how sources are weighted and how timing windows are drawn.",
  },
];

function HowItWorks() {
  return (
    <div className="flex-1 bg-vellum text-ink">
      <section className="mx-auto max-w-4xl px-5 py-16 sm:px-8 sm:py-24">
        <p className="label-mono text-signal">The loop</p>
        <h1 className="mt-5 font-display text-4xl leading-[1.05] sm:text-5xl">
          Four steps, run continuously
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground">
          The example below is a real shape of query: a supplier with 5,000 televisions in Nigeria,
          minimum order 20 units.
        </p>

        <ol className="mt-12 space-y-10">
          {steps.map((s) => (
            <li key={s.n} className="border-t border-border pt-6">
              <div className="flex items-baseline gap-4">
                <span className="font-mono text-sm text-signal">{s.n}</span>
                <h2 className="font-display text-2xl">{s.title}</h2>
              </div>
              <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
                {s.body}
              </p>
            </li>
          ))}
        </ol>

        <section className="mt-16 rounded-md border border-border bg-card p-6 sm:p-8">
          <p className="label-mono text-muted-foreground">Evidence clustering</p>
          <h2 className="mt-3 font-display text-2xl">Five agents, three independent sources</h2>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
            Agents surface evidence independently. Before anything reaches a confidence score, the
            system deduplicates by underlying source, so repetition never looks like corroboration.
          </p>

          <div className="mt-8 grid items-center gap-6 sm:grid-cols-[1fr_auto_1fr]">
            <ul className="space-y-2">
              {[
                "Agent A · planning portal",
                "Agent B · planning portal",
                "Agent C · local press",
                "Agent D · local press",
                "Agent E · company filing",
              ].map((a) => (
                <li
                  key={a}
                  className="rounded-sm border border-border bg-background px-3 py-2 font-mono text-xs"
                >
                  {a}
                </li>
              ))}
            </ul>
            <div aria-hidden className="mx-auto h-px w-full bg-signal sm:h-40 sm:w-px" />
            <div className="rounded-sm border border-signal/50 bg-background p-4">
              <p className="label-mono text-signal">Evidence cluster EV-4471</p>
              <ul className="mt-3 space-y-1.5 font-mono text-xs text-muted-foreground">
                <li>SOURCE 1 planning portal (2 agents)</li>
                <li>SOURCE 2 local press (2 agents)</li>
                <li>SOURCE 3 company filing (1 agent)</li>
              </ul>
              <p className="mt-4 font-mono text-xs text-verified">
                5 agents, 3 independent sources · confidence 82%
              </p>
            </div>
          </div>
        </section>

        <p className="mt-12 max-w-2xl text-base leading-relaxed text-muted-foreground">
          Nothing here is settled by a vote count. Predictions are scored against outcomes, and both
          hits and misses change how the next one is weighted.{" "}
          <Link to="/trust" className="text-signal underline underline-offset-4">
            See how we show our work
          </Link>
          .
        </p>

        <section className="mt-16 rounded-md border border-border bg-card p-6 sm:p-8" aria-labelledby="connect-agent">
          <p className="label-mono text-signal">For agents</p>
          <h2 id="connect-agent" className="mt-3 font-display text-2xl">
            Connect your agent
          </h2>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
            StockIntel runs next to the Binance server inside your own agent session. Add us
            once, then ask for market reads, theses, evidence, or a fresh live investigation.
            Read-only, no key needed.
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="rounded-sm border border-border bg-background p-4">
              <p className="label-mono text-muted-foreground">Claude Code</p>
              <pre className="mt-2 overflow-x-auto font-mono text-xs leading-relaxed">
                claude mcp add stockintel --transport http https://stockintelislive.vercel.app/mcp
              </pre>
            </div>
            <div className="rounded-sm border border-border bg-background p-4">
              <p className="label-mono text-muted-foreground">VS Code</p>
              <p className="mt-2 font-mono text-xs leading-relaxed text-muted-foreground">
                Open this repo. Both servers start from .vscode/mcp.json, then MCP List Servers,
                authenticate the Binance one.
              </p>
            </div>
            <div className="rounded-sm border border-border bg-background p-4">
              <p className="label-mono text-muted-foreground">Cursor</p>
              <p className="mt-2 font-mono text-xs leading-relaxed text-muted-foreground">
                Settings, MCP, add https://stockintelislive.vercel.app/mcp as a Streamable HTTP
                server.
              </p>
            </div>
            <div className="rounded-sm border border-border bg-background p-4">
              <p className="label-mono text-muted-foreground">ChatGPT and Codex</p>
              <p className="mt-2 font-mono text-xs leading-relaxed text-muted-foreground">
                Add the same URL as a connector in settings, then authenticate.
              </p>
            </div>
          </div>

          <h3 className="mt-8 font-display text-xl">What each call does</h3>
          <ul className="mt-4 space-y-3">
            {[
              ["stockintel_read", "Live prices, 24h move, and the positioning gauge for up to 20 tickers."],
              ["stockintel_assess", "The full thesis for a ticker, priced or not, with market calls."],
              ["stockintel_clusters", "Grouped evidence per exposure, no verdicts."],
              ["stockintel_thesis_changes", "What moved between the last two assessments, plus history."],
              ["stockintel_conflicting", "What argues against the latest thesis, from stored data only."],
              ["stockintel_evidence", "Drill one thread down to sources, cluster, and top claims."],
              ["stockintel_investigate", "Starts the full ten-specialist grid, returns an inquiry id."],
              ["stockintel_inquiry", "Polls that investigation to the finished thesis."],
              ["stockintel_status", "Whether this deployment holds its own Agent OS session."],
            ].map(([name, body]) => (
              <li key={name} className="border-t border-border pt-3">
                <p className="font-mono text-sm text-signal">{name}</p>
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">{body}</p>
              </li>
            ))}
          </ul>

          <p className="mt-8 max-w-2xl text-base leading-relaxed text-muted-foreground">
            Prefer plain web requests? Every tool above has an HTTP twin under /api/market, and
            your own Binance numbers ride along as caller-supplied context. The full contract
            lives in skills/stockintel/SKILL.md in the repo.
          </p>
        </section>
      </section>
    </div>
  );
}
