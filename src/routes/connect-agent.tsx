import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/connect-agent")({
  head: () => ({
    meta: [
      { title: "Connect your agent · StockIntel" },
      {
        name: "description",
        content:
          "Run StockIntel inside your own agent session: setup for Claude Code, VS Code, Cursor, ChatGPT and Codex, plus what each call does.",
      },
    ],
  }),
  component: ConnectAgent,
});

const clients = [
  {
    name: "Claude Code",
    body: "claude mcp add stockintel --transport http https://stockintelislive.vercel.app/mcp",
    code: true,
  },
  {
    name: "VS Code",
    body: "Open this repo. Both servers start from .vscode/mcp.json, then MCP List Servers, authenticate the Binance one.",
    code: false,
  },
  {
    name: "Cursor",
    body: "Settings, MCP, add https://stockintelislive.vercel.app/mcp as a Streamable HTTP server.",
    code: false,
  },
  {
    name: "ChatGPT and Codex",
    body: "Add the same URL as a connector in settings, then authenticate.",
    code: false,
  },
];

const tools: [string, string][] = [
  ["stockintel_read", "Live prices, 24h move, and the positioning gauge for up to 20 tickers."],
  ["stockintel_assess", "The full thesis for a ticker, priced or not, with market calls."],
  ["stockintel_clusters", "Grouped evidence per exposure, no verdicts."],
  ["stockintel_thesis_changes", "What moved between the last two assessments, plus history."],
  ["stockintel_conflicting", "What argues against the latest thesis, from stored data only."],
  ["stockintel_evidence", "Drill one thread down to sources, cluster, and top claims."],
  ["stockintel_investigate", "Starts the full ten-specialist grid, returns an inquiry id."],
  ["stockintel_inquiry", "Polls that investigation to the finished thesis."],
  ["stockintel_status", "Whether this deployment holds its own Agent OS session."],
];

function ConnectAgent() {
  return (
    <div className="flex-1 bg-vellum text-ink">
      <section className="mx-auto max-w-4xl px-5 py-16 sm:px-8 sm:py-24">
        <p className="label-mono text-signal">For agents</p>
        <h1 className="mt-5 font-display text-4xl leading-[1.05] sm:text-5xl">
          Connect your agent
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground">
          StockIntel runs next to the Binance server inside your own agent session. Add us
          once, then ask for market reads, theses, evidence, or a fresh live investigation.
          Read-only, no key needed.
        </p>

        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {clients.map((c) => (
            <div key={c.name} className="rounded-md border border-border bg-card p-5">
              <p className="label-mono text-muted-foreground">{c.name}</p>
              {c.code ? (
                <pre className="mt-2 overflow-x-auto font-mono text-xs leading-relaxed">
                  {c.body}
                </pre>
              ) : (
                <p className="mt-2 font-mono text-xs leading-relaxed text-muted-foreground">
                  {c.body}
                </p>
              )}
            </div>
          ))}
        </div>

        <h2 className="mt-14 font-display text-2xl">What each call does</h2>
        <ul className="mt-6 space-y-3">
          {tools.map(([name, body]) => (
            <li key={name} className="border-t border-border pt-3">
              <p className="font-mono text-sm text-signal">{name}</p>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">{body}</p>
            </li>
          ))}
        </ul>

        <p className="mt-10 max-w-2xl text-base leading-relaxed text-muted-foreground">
          Prefer plain web requests? Every tool above has an HTTP twin under /api/market, and
          your own Binance numbers ride along as caller-supplied context. The full contract
          lives in skills/stockintel/SKILL.md in the repo.
        </p>
      </section>
    </div>
  );
}
