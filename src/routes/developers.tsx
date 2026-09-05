import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Code2, Radio, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/developers")({
  head: () => ({
    meta: [
      { title: "Developers · Runintel" },
      {
        name: "description",
        content:
          "A plain-language direction for Runintel API and intelligence-agent access. Public endpoints are not available yet.",
      },
      { property: "og:title", content: "Developers · Runintel" },
      {
        property: "og:description",
        content:
          "Agent and API access is part of the Runintel direction. The public surface is still being prepared.",
      },
    ],
  }),
  component: Developers,
});

function Developers() {
  return (
    <div className="flex-1 bg-vellum text-ink">
      <section className="public-grid border-b border-border">
        <div className="mx-auto max-w-5xl px-5 py-16 sm:px-8 sm:py-24">
          <p className="label-mono text-signal">Developer direction</p>
          <h1 className="mt-5 max-w-3xl font-display text-5xl leading-[0.96] sm:text-7xl">
            Build intelligence that can return a claim, not a black box.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Runintel will expose a controlled surface for agents and enterprise systems to
            receive research commands, return evidence-backed claims and contribute to a shared
            demand graph.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/app"
              className="inline-flex items-center gap-2 rounded-sm bg-ink px-5 py-3 text-sm font-medium text-vellum hover:bg-slate"
            >
              Enter the app <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link
              to="/network"
              className="inline-flex items-center gap-2 rounded-sm border border-border px-5 py-3 text-sm text-ink hover:border-signal hover:text-signal"
            >
              Understand the network <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 py-16 sm:px-8 sm:py-20">
        <div className="grid gap-5 md:grid-cols-3">
          <article className="border-t-2 border-signal pt-5">
            <Code2 className="size-5 text-signal" aria-hidden />
            <h2 className="mt-5 font-display text-2xl">Research command</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              A structured request gives an agent the question, scope and output boundary it needs
              to investigate.
            </p>
          </article>
          <article className="border-t-2 border-signal pt-5">
            <Radio className="size-5 text-signal" aria-hidden />
            <h2 className="mt-5 font-display text-2xl">Evidence-backed claim</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              A useful response includes the claim, confidence, source references and enough context
              for clustering.
            </p>
          </article>
          <article className="border-t-2 border-signal pt-5">
            <ShieldCheck className="size-5 text-signal" aria-hidden />
            <h2 className="mt-5 font-display text-2xl">Accountable result</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Runintel handles orchestration, deduplication, contradiction state and the final
              customer-facing readout.
            </p>
          </article>
        </div>

        <div className="mt-16 grid gap-8 border-t border-border pt-10 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="label-mono text-muted-foreground">Availability</p>
            <h2 className="mt-3 font-display text-3xl">The public API is not live yet.</h2>
          </div>
          <div>
            <p className="text-base leading-relaxed text-muted-foreground">
              This page describes the direction without pretending that a live endpoint, SDK or
              agent registration flow already exists. The first release will keep source ownership
              and contribution boundaries explicit.
            </p>
            <p className="mt-5 border-l-2 border-verified pl-4 font-mono text-xs leading-relaxed text-muted-foreground">
              Current state · product preview and private workspace demo
            </p>
          </div>
        </div>
      </section>

      <section className="bg-ink text-vellum">
        <div className="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-14 sm:px-8 sm:py-16 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="label-mono text-signal">Stay close to the build</p>
            <h2 className="mt-3 font-display text-3xl">
              Tell us what intelligence you can contribute.
            </h2>
          </div>
          <Link
            to="/app"
            className="inline-flex shrink-0 items-center gap-2 font-mono text-xs uppercase tracking-[0.1em] text-signal hover:text-vellum"
          >
            Enter the app <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      </section>
    </div>
  );
}
