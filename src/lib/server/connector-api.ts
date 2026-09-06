import { z } from "zod";
import { db, ensureSchema, nowIso, newId } from "@/lib/db";
import { agents, claims, dispatchAcks, inquiries } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { agenticIdConfig, mintAgentIdentity } from "@/lib/base/agentic-id";

/**
 * Connector protocol — the HTTP surface external agents talk to.
 * Handled from the server entry so it works identically in dev and prod.
 *
 *  POST /api/agents/register  { name, specialty, endpoint, wallet, agenticId? }
 *  POST /api/claims/submit    { command_id, agent_id, claims: [{ company, claim, confidence, evidence[] }] }
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      // Agents run on their own hosts (AWS, VPS, laptops) — browser-less
      // fetches don't need this, but it costs nothing and keeps the grid
      // open to any agent dashboard that wants to call us from a page.
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
    },
  });

const registerSchema = z.object({
  name: z.string().min(2).max(80),
  // Self-declared, informational only. The grid never routes by it —
  // agents decide for themselves which inquiries to answer.
  specialty: z.string().max(160).optional(),
  endpoint: z.string().url().max(300),
  wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "wallet must be an EVM address"),
  agenticId: z.string().max(80).optional(),
});

const submitSchema = z.object({
  command_id: z.string().min(3),
  inquiry_id: z.string().min(3),
  agent_id: z.string().min(3),
  claims: z
    .array(
      z.object({
        company: z.string().min(1).max(120),
        claim: z.string().min(1).max(500),
        confidence: z.number().min(0).max(1),
        evidence: z
          .array(
            z.object({
              item: z.string().max(300),
              source: z.string().max(300),
              observed: z.string().max(40),
            }),
          )
          .min(1),
      }),
    )
    .max(50),
});

export async function handleConnectorApi(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type",
      },
    });
  }
  if (request.method === "POST" && url.pathname === "/api/agents/register") {
    return registerAgent(request);
  }
  if (request.method === "POST" && url.pathname === "/api/claims/submit") {
    return submitClaims(request);
  }
  if (request.method === "GET" && url.pathname === "/api/health") {
    return json({ ok: true, service: "prime-layer-orchestrator" });
  }
  if (request.method === "GET" && url.pathname === "/api/binance/status") {
    return binanceStatus();
  }
  if (request.method === "POST" && url.pathname === "/api/market/read") {
    return marketReadRoute(request);
  }
  if (request.method === "POST" && url.pathname === "/api/market/assess") {
    return marketAssessRoute(request);
  }
  if (request.method === "POST" && url.pathname === "/api/market/clusters") {
    return marketClustersRoute(request);
  }
  return json({ error: "Not found" }, 404);
}

/** Read-only Agent OS state plus a non-throwing live probe. Needs no key. */
async function binanceStatus(): Promise<Response> {
  const { resolveAgentOsToken, appOrigin } = await import("@/lib/binance/oauth");
  const { agentOsStatus } = await import("@/lib/binance/agent-os");
  const token = await resolveAgentOsToken(null);
  const probe = await agentOsStatus(token);
  return json({ origin: appOrigin(), probe });
}

const marketReadSchema = z.object({
  tickers: z.array(z.string().max(40)).min(1).max(20),
  binance_market_data: z.unknown().optional(),
  identity: z.string().min(1).max(160).optional(),
});

const tickerSchema = z.object({ ticker: z.string().min(1).max(12) });

/** Full thesis for a ticker from the latest completed investigation. */
async function marketAssessRoute(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const parsed = tickerSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Validation failed", issues: parsed.error.issues }, 400);
  }
  const { agentAssess } = await import("@/lib/orchestrator/agent-read");
  return json(await agentAssess(parsed.data.ticker));
}

/** Cluster results only for a ticker: grouped evidence, no thesis. */
async function marketClustersRoute(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const parsed = tickerSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Validation failed", issues: parsed.error.issues }, 400);
  }
  const { agentClusters } = await import("@/lib/orchestrator/agent-read");
  return json(await agentClusters(parsed.data.ticker));
}
async function marketReadRoute(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const parsed = marketReadSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Validation failed", issues: parsed.error.issues }, 400);
  }
  const { marketRead } = await import("@/lib/binance/read");
  try {
    const { quotes } = await marketRead({
      tickers: parsed.data.tickers,
      ...(parsed.data.binance_market_data !== undefined
        ? { marketData: parsed.data.binance_market_data }
        : {}),
      ...(parsed.data.identity ? { identity: parsed.data.identity } : {}),
    });
    return json({ quotes });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Market read failed" }, 500);
  }
}

async function registerAgent(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Validation failed", issues: parsed.error.issues }, 400);
  }

  await ensureSchema();
  const { name, specialty, endpoint, wallet, agenticId } = parsed.data;

  // Re-registering the same endpoint updates rather than duplicates.
  const existing = await db.select().from(agents).where(eq(agents.endpoint, endpoint));
  if (existing.length > 0) {
    const [row] = existing;
    await db
      .update(agents)
      .set({
        name,
        specialty,
        wallet,
        ...(agenticId ? { agenticId } : {}),
        status: "online",
        lastSeen: nowIso(),
      })
      .where(eq(agents.id, row!.id));
    return json({ agent_id: row!.id, updated: true });
  }

  const id = newId("agt");
  await db.insert(agents).values({
    id,
    name,
    specialty: specialty ?? "",
    endpoint,
    wallet,
    ...(agenticId ? { agenticId } : {}),
    status: "online",
    createdAt: nowIso(),
    lastSeen: nowIso(),
  });

  // First-time registration → mint an Agentic ID owned by the agent's wallet.
  // Fire-and-forget: identity is an enhancement, never a gate. If the mint
  // fails the agent still participates; a later backfill can retry.
  if (!agenticId && agenticIdConfig().live) {
    void mintAgentIdentity({ agentDbId: id, name, specialty, wallet, endpoint })
      .then(async (minted) => {
        await db
          .update(agents)
          .set({ agenticId: `0x7857:${minted.tokenId}` })
          .where(eq(agents.id, id));
        console.log(
          `agentic-id minted for ${name}: token ${minted.tokenId} → ${minted.explorerUrl}`,
        );
      })
      .catch((err) => console.error(`agentic-id mint deferred for ${name}:`, err.message));
  }

  return json({ agent_id: id, created: true });
}

async function submitClaims(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Validation failed", issues: parsed.error.issues }, 400);
  }

  await ensureSchema();
  const { command_id, inquiry_id, agent_id, claims: submissions } = parsed.data;

  const [inquiry] = await db.select().from(inquiries).where(eq(inquiries.id, inquiry_id));
  if (!inquiry) {
    return json({ error: "Unknown inquiry." }, 404);
  }
  if (
    inquiry.status !== "collecting" &&
    inquiry.status !== "grading" &&
    inquiry.status !== "dispatching"
  ) {
    return json({ error: `Inquiry is ${inquiry.status}; not collecting claims.` }, 409);
  }

  if (inquiry.windowClosesAt && Date.now() > Date.parse(inquiry.windowClosesAt)) {
    return json({ error: "Sourcing window closed. Submission graded into next cycle." }, 409);
  }

  for (const c of submissions) {
    await db.insert(claims).values({
      inquiryId: inquiry.id,
      agentId: agent_id,
      company: c.company,
      claim: c.claim,
      confidence: c.confidence,
      evidenceJson: JSON.stringify(c.evidence),
      submittedAt: nowIso(),
    });
  }

  // Every response — claims or an explicit decline — is acknowledged, so the
  // orchestrator can early-exit once the whole grid has answered.
  await db.insert(dispatchAcks).values({
    inquiryId: inquiry.id,
    agentId: agent_id,
    declined: submissions.length === 0 ? 1 : 0,
    respondedAt: nowIso(),
  });

  return json({
    accepted: submissions.length,
    ...(submissions.length === 0
      ? { note: "Decline recorded. Silence is free; declines are polite." }
      : {}),
    inquiry_id: inquiry.id,
    ...(submissions.length > 0
      ? { note: "Graded after clustering. Weight follows proven independence." }
      : {}),
  });
}
