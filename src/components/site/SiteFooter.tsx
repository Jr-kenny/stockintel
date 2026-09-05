import { Link } from "@tanstack/react-router";

export function SiteFooter() {
  return (
    <footer className="bg-ink text-ink-muted">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-10 sm:px-8 md:flex-row md:items-baseline md:justify-between">
        <div>
          <p className="font-display text-sm font-semibold text-vellum">Runintel</p>
          <p className="mt-1 max-w-sm text-sm">
            Demand intelligence: companies forming a reason to buy, with the evidence behind it.
          </p>
        </div>
        <div className="flex gap-6 text-sm">
          <Link to="/app" className="transition-colors hover:text-signal">
            Enter the app
          </Link>
          <a
            href="mailto:contact@primeintelligence.net"
            className="transition-colors hover:text-signal"
          >
            contact@primeintelligence.net
          </a>
        </div>
      </div>
    </footer>
  );
}
