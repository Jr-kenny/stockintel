/**
 * Sample Prime Layer connector — reference implementation for agent developers.
 *
 *   bun run examples/sample-connector.ts "Hospitality events, Lagos"
 *
 * What it does:
 *   1. Registers your agent against the grid (wallet = settlement address).
 *   2. Listens for dispatched research commands.
 *   3. Performs its "research" (this sample echoes one claim — replace this
 *      function with your real scraper/API/model pipeline).
 *   4. Submits claims + evidence back to the orchestrator within the window.
 */

const ORCHESTRATOR = process.env["PRIME_ORCHESTRATOR"] ?? "http://localhost:8081";
const PORT = Number(process.env["CONNECTOR_PORT"] ?? 8787);

const name = "Sample Registry Watch";
const specialty = process.argv[2] ?? "hospitality lagos";
const wallet = process.env["CONNECTOR_WALLET"] ?? "0x0000000000000000000000000000000000000001";

async function main() {
  const registerRes = await fetch(`${ORCHESTRATOR}/api/agents/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name,
      specialty,
      endpoint: `http://localhost:${PORT}/claim`,
      wallet,
    }),
  });
  const registered = await registerRes.json();
  if (!registerRes.ok) throw new Error(`Registration failed: ${JSON.stringify(registered)}`);
  console.log("✓ registered:", registered);

  Bun.serve({
    port: PORT,
    async fetch(request) {
      const url = new URL(request.url);
      if (request.method === "POST" && url.pathname === "/claim") {
        const command = await request.json();
        console.log("→ research command received:", command.command_id);
        // Source asynchronously — the orchestrator collects until its window closes.
        void researchAndSubmit(command);
        return Response.json({ accepted: true });
      }
      return new Response("prime-layer sample connector", { status: 200 });
    },
  });

  console.log(`✓ connector listening on http://localhost:${PORT}/claim`);
}

type ResearchCommand = {
  command_id: string;
  inquiry_id: string;
  question: string;
  scope: { category?: string; geography?: string };
  window_seconds: number;
  submit_url: string;
};

/** REPLACE THIS with your real intelligence pipeline. */
async function researchAndSubmit(command: ResearchCommand) {
  // ─── Self-selection ───────────────────────────────────────────────────────
  // The grid never pre-filters. YOUR agent decides whether a demand is its
  // kind of job. This sample knows hospitality & construction signals in
  // Nigeria/Ghana; anything else gets a polite, free decline.
  const question = command.question.toLowerCase();
  const myWorld = ["hospital", "hotel", "construction", "permit", "estate", "fit-out"];
  const relevant = myWorld.some((word) => question.includes(word));

  if (!relevant) {
    const decline = await fetch(command.submit_url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command_id: command.command_id,
        inquiry_id: command.inquiry_id,
        agent_id: (await getAgentId()).agent_id,
        claims: [], // empty = explicit decline; silence also works and costs nothing
      }),
    });
    console.log("✗ declined (not my market):", await decline.json());
    return;
  }

  // ─── Research (your scraper / API / model / private data) ────────────────
  const geo = command.scope.geography ?? "your market";
  const claims = [
    {
      company: "Sample Industries Ltd",
      claim: `Sample connector observed expansion activity relevant to: ${command.question.slice(0, 80)}`,
      confidence: 0.62,
      evidence: [
        {
          item: "Business registration update (sample)",
          source: `https://example.com/registry/${geo.toLowerCase()}`,
          observed: new Date().toISOString().slice(0, 10),
        },
      ],
    },
  ];

  const res = await fetch(command.submit_url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      command_id: command.command_id,
      inquiry_id: command.inquiry_id,
      agent_id: (await getAgentId()).agent_id,
      claims,
    }),
  });
  const result = await res.json();
  console.log(res.ok ? "✓ claims submitted:" : "✗ submission rejected:", result);
}

let agentIdCache: { agent_id: string } | null = null;
async function getAgentId() {
  if (agentIdCache) return agentIdCache;
  const registerRes = await fetch(`${ORCHESTRATOR}/api/agents/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name,
      specialty,
      endpoint: `http://localhost:${PORT}/claim`,
      wallet,
    }),
  });
  agentIdCache = await registerRes.json();
  return agentIdCache;
}

await main();
