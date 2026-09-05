import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Menu, X } from "lucide-react";

const links = [
  { to: "/product", label: "Product" },
  { to: "/network", label: "Network" },
  { to: "/how-it-works", label: "How it works" },
  { to: "/trust", label: "Trust" },
] as const;

export function SiteNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 bg-ink text-vellum">
      <nav
        aria-label="Primary"
        className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-5 py-4 sm:px-8"
      >
        <Link to="/" className="flex items-center gap-2.5" onClick={() => setOpen(false)}>
          <span className="size-2 rounded-full bg-signal animate-signal-pulse" aria-hidden />
          <span className="font-display text-base font-semibold tracking-tight">StockIntel</span>
        </Link>

        <div className="hidden items-center gap-7 md:flex">
          {links.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              activeOptions={{ exact: true }}
              className="text-sm text-ink-muted transition-colors hover:text-vellum data-[status=active]:text-signal"
            >
              {l.label}
            </Link>
          ))}
          <Link
            to="/app"
            className="rounded-sm bg-signal px-4 py-1.5 text-sm font-medium text-ink transition-opacity hover:opacity-90"
          >
            Enter
          </Link>
        </div>

        <button
          type="button"
          className="md:hidden"
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </nav>

      {open && (
        <div className="border-t border-ink-border px-5 py-3 md:hidden">
          <ul className="flex flex-col">
            {links.map((l) => (
              <li key={l.to}>
                <Link
                  to={l.to}
                  activeOptions={{ exact: true }}
                  onClick={() => setOpen(false)}
                  className="block py-2.5 text-sm text-ink-muted data-[status=active]:text-signal"
                >
                  {l.label}
                </Link>
              </li>
            ))}
            <li>
              <Link
                to="/app"
                onClick={() => setOpen(false)}
                className="mt-2 inline-block rounded-sm border border-signal px-3.5 py-1.5 text-sm text-signal"
              >
                Enter
              </Link>
            </li>
          </ul>
        </div>
      )}
    </header>
  );
}
