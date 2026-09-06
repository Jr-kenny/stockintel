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
    name: "Codex",
    body: "codex mcp add stockintel --url https://stockintelislive.vercel.app/mcp",
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
    name: "ChatGPT on web",
    body: "Settings, Security, turn on Developer Mode and log in. Open Plugins, press +, name it StockIntel, paste https://stockintelislive.vercel.app/mcp as the plugin URL, Create.",
    code: false,
  },
];

const tools: [string, string][] = [
  ["stockintel_investigate", "Starts the full ten-specialist grid on your question, returns an inquiry id."],
  ["stockintel_inquiry", "Polls that investigation to the finished thesis."],
  ["stockintel_assess", "The latest stored thesis for a ticker, priced or not, with market calls."],
  ["stockintel_clusters", "Grouped evidence per exposure, no verdicts."],
  ["stockintel_thesis_changes", "What moved between the last two assessments, plus history."],
  ["stockintel_conflicting", "What argues against the latest thesis, from stored data only."],
  ["stockintel_evidence", "Drill one thread down to sources, cluster, and top claims."],
  ["stockintel_read", "Live prices, 24h move, and the positioning gauge for up to 20 tickers."],
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

        <section className="mt-10 rounded-md border border-border bg-card p-6 sm:p-8" aria-labelledby="quickstart">
          <p className="label-mono text-signal">Quickstart</p>
          <h2 id="quickstart" className="mt-3 font-display text-2xl">
            Your agent can read the market in one request
          </h2>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
            Plain HTTP, JSON in, JSON out. Install the skill and any Agent OS client, Claude
            Code, Codex, ChatGPT, can call it by name.
          </p>
          <div className="mt-6 space-y-4">
            <div className="rounded-sm border border-border bg-background p-4">
              <p className="label-mono text-muted-foreground">1, a live market read</p>
              <pre className="mt-2 overflow-x-auto font-mono text-xs leading-relaxed">
{`curl -s -X POST https://stockintelislive.vercel.app/api/market/read \\
  -H "Content-Type: application/json" -d '{"tickers":["NVDA"]}'`}
              </pre>
            </div>
            <div className="rounded-sm border border-border bg-background p-4">
              <p className="label-mono text-muted-foreground">2, the thesis behind it</p>
              <pre className="mt-2 overflow-x-auto font-mono text-xs leading-relaxed">
{`curl -s -X POST https://stockintelislive.vercel.app/api/market/assess \\
  -H "Content-Type: application/json" -d '{"ticker":"NVDA"}'`}
              </pre>
            </div>
            <div className="rounded-sm border border-border bg-background p-4">
              <p className="label-mono text-muted-foreground">3, or run it as an MCP server, beside Binance's own</p>
              <pre className="mt-2 overflow-x-auto font-mono text-xs leading-relaxed">
{`claude mcp add binance-mcp-server --transport http https://agent.binance.com/mcp/agentic
claude mcp add stockintel --transport http https://stockintelislive.vercel.app/mcp`}
              </pre>
            </div>
          </div>
        </section>

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

        <h2 className="mt-14 font-display text-2xl">What a thesis looks like</h2>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
          The grid observes and hypothesizes. The orchestrator connects the dots into one
          assessment per exposure. Example shape below, illustrative, not a live call.
        </p>
        <div className="mt-6 rounded-md border border-border bg-card p-6">
          <p className="label-mono text-signal">01 · Assessment · Not yet priced</p>
          <p className="mt-2 font-mono text-sm text-ink">
            Hyperscale buildout → GPU demand → NVIDIA → TSMC capacity
          </p>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            A $10B data-center expansion fans out through GPUs, memory, servers, and power.
            The chain reaches NVIDIA through confirmed procurement, and the observed price
            move does not yet reflect it. Breaks if the buildout slips a quarter or the
            order goes elsewhere.
          </p>
          <p className="mt-3 font-mono text-xs text-muted-foreground">
            Market call · timeframe 1 to 4 weeks · confidence 82%
          </p>
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

        <section className="mt-12 rounded-md border border-border bg-card p-6 sm:p-8" aria-labelledby="check-connection">
          <p className="label-mono text-signal">Check the connection works</p>
          <h2 id="check-connection" className="mt-3 font-display text-2xl">
            One prompt proves it
          </h2>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
            In your agent chat, enter: use the StockIntel MCP server to read NVDA. Confirm
            the response shows the StockIntel tool being used and returns a live read. For
            the combined proof, ask it to fetch the BTC ticker from your Binance tools first
            and pass that output into the StockIntel read.
          </p>
        </section>
      </section>
    </div>
  );
}
