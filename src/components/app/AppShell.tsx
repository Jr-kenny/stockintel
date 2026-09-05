import { Link, useLocation } from "@tanstack/react-router";
import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { Boxes, FileSearch, History, Radar, GitBranch, Menu, X } from "lucide-react";
import { WorkspaceAuthShell } from "@/components/app/WorkspaceAuthShell";
import { getNavCounts } from "@/lib/orchestrator/nav-counts";

type NavNote = string | number | null;

const workspaceNav = [
  { to: "/app", label: "Intelligence", icon: Radar, exact: true, note: "command" as NavNote },
  {
    to: "/app/demand-graph",
    label: "Exposure Graph",
    icon: GitBranch,
    exact: false,
    note: "live" as NavNote,
  },
  { to: "/app/recent", label: "Recent runs", icon: History, exact: false, note: null as NavNote },
  { to: "/app/supply", label: "Watchlist", icon: Boxes, exact: false, note: null as NavNote },
  { to: "/app/evidence", label: "Evidence", icon: FileSearch, exact: false, note: null as NavNote },
] as const;

/** Live counts from the server; applied to matching nav items by path. */
function useLiveNotes() {
  const [notes, setNotes] = useState<Record<string, NavNote>>({});
  useEffect(() => {
    let cancelled = false;
    void getNavCounts().then((c) => {
      if (!cancelled && c) {
        setNotes({
          "/app/supply": c.supply > 0 ? c.supply : "add yours",
          "/app/evidence": c.evidence > 0 ? c.evidence : "•",
        });
      }
    });
    const t = window.setInterval(() => {
      void getNavCounts().then((c) => {
        if (c)
          setNotes({
            "/app/supply": c.supply > 0 ? c.supply : "add yours",
            "/app/evidence": c.evidence > 0 ? c.evidence : "•",
          });
      });
    }, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);
  return notes;
}

function NavLinkList({
  items,
  liveNotes,
  onNavigate,
}: {
  items: readonly {
    to: string;
    label: string;
    icon: typeof Radar;
    exact: boolean;
    note: NavNote;
  }[];
  liveNotes: Record<string, NavNote>;
  onNavigate?: (() => void) | undefined;
}) {
  return (
    <nav className="app-nav-list">
      {items.map((item) => {
        const note = item.to in liveNotes ? liveNotes[item.to] : item.note;
        return (
          <Link
            key={item.to}
            to={item.to}
            activeOptions={{ exact: item.exact }}
            onClick={onNavigate}
            className="app-nav-link"
          >
            <span className="app-nav-icon">
              <item.icon className="size-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">{item.label}</span>
            {note !== null && note !== "" && <span className="app-nav-note">{note}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const liveNotes = useLiveNotes();
  return (
    <div className="app-nav-stack">
      <p className="app-nav-caption">Workspace</p>
      <NavLinkList items={workspaceNav} liveNotes={liveNotes} onNavigate={onNavigate} />
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`app-brand ${compact ? "app-brand-compact" : ""}`}>
      <span className="app-brand-mark" aria-hidden>
        <span />
        <span />
        <span />
      </span>
      <span>
        <span className="app-brand-name">StockIntel</span>
        {!compact && <span className="app-brand-subtitle">Market intelligence network</span>}
      </span>
    </span>
  );
}

function TopbarSection() {
  const sections: [prefix: string, label: string][] = [
    ["/app/demand-graph", "Exposure Graph"],
    ["/app/recent", "Recent runs"],
    ["/app/supply", "Watchlist"],
    ["/app/evidence", "Evidence"],
  ];
  const pathname = useLocation({ select: (l) => l.pathname });
  if (pathname.startsWith("/app/opportunities")) {
    return <span className="app-topbar-name">Case file</span>;
  }
  const hit = sections.find(([prefix]) => pathname.startsWith(prefix));
  return <span className="app-topbar-name">{hit ? hit[1] : "Intelligence"}</span>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="app-shell">
      <aside className="app-rail">
        <div>
          <Link to="/" className="app-rail-brand" aria-label="StockIntel: back to the city">
            <Brand />
          </Link>
          <div className="app-rail-rule" />
          <NavList />
        </div>

        <div className="app-rail-footer">
          <WorkspaceAuthShell />
        </div>
      </aside>

      <div className="app-main-column">
        <header className="app-mobile-header">
          <Link to="/" aria-label="StockIntel: back to the city">
            <Brand compact />
          </Link>
          <button
            type="button"
            className="app-menu-button"
            aria-expanded={open}
            aria-controls="mobile-app-navigation"
            aria-label={open ? "Close workspace menu" : "Open workspace menu"}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </header>
        {open && (
          <div id="mobile-app-navigation" className="app-mobile-nav">
            <NavList onNavigate={() => setOpen(false)} />
          </div>
        )}

        <div className="app-topbar">
          <div className="app-topbar-context">
            <span className="app-topbar-kicker">Workspace</span>
            <span className="app-topbar-separator" aria-hidden />
            <TopbarSection />
          </div>
        </div>

        <main className="app-main">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  intro?: string;
  children?: ReactNode;
}) {
  return (
    <header className="app-page-header">
      <div className="app-page-header-inner">
        <div className="app-page-header-copy">
          <p className="label-mono app-page-kicker">{eyebrow}</p>
          <h1>{title}</h1>
          {intro && <p className="app-page-intro">{intro}</p>}
        </div>
        {children}
      </div>
    </header>
  );
}
