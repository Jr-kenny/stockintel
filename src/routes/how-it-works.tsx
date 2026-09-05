import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/how-it-works")({
  head: () => ({
    meta: [
      { title: "How it works · Runintel" },
      {
        name: "description",
        content:
          "Signal, Evidence, Prediction, Outcome: the four-step loop behind the Demand Graph, including how evidence from multiple agents is clustered into independent sources.",
      },
      { property: "og:title", content: "How it works · Runintel" },
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
      </section>
    </div>
  );
}
