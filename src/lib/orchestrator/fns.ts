import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { db, ensureSchema, nowIso, newId } from "@/lib/db";
import { inquiries, agents, supplyRecords, accounts } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { reportSchema, type IntelligenceReport } from "@/lib/orchestrator/report";

/**
 * Sourcing window hint for the UI poll. The orchestrator service on AWS owns
 * the real window (run.ts), this only tells the client how long to expect.
 * Kept local so the web build never pulls the orchestrator into serverless.
 */
const SOURCING_WINDOW_SECONDS = Math.min(
  3600,
  Math.max(60, Number(process.env["PRIME_SOURCING_WINDOW_SECONDS"] ?? 300)),
);

export type { IntelligenceReport };

const submitSchema = z.object({
  question: z.string().min(8).max(500),
  identity: z.string().min(3).max(120).optional(),
  email: z.string().max(160).optional(),
  wallet: z.string().max(60).optional(),
});

export type ReadoutEntry = {
  company: string;
  confidence: number;
  claims: number;
  independentSources: number;
  topClaim: string;
  sources: { label: string; url: string }[];
  contact?: string | null;
  facts?: string[];
  inferences?: string[];
  contributingAgents: string[];
};

const readoutSchema = z.array(
  z.object({
    company: z.string(),
    confidence: z.number(),
    claims: z.number(),
    independentSources: z.number(),
    topClaim: z.string(),
    sources: z
      .array(z.object({ label: z.string(), url: z.string() }))
      .optional()
      .default([]),
    contact: z.string().max(280).optional().nullable(),
    facts: z.array(z.string()).optional().default([]),
    inferences: z.array(z.string()).optional().default([]),
    contributingAgents: z.array(z.string()),
  }),
);

export const submitInquiry = createServerFn({ method: "POST" })
  .validator((input: unknown) => submitSchema.parse(input))
  .handler(async ({ data }) => {
    await ensureSchema();
    const id = newId("INQ");
    const ts = nowIso();

    await db.insert(inquiries).values({
      id,
      identity: data.identity ?? null,
      question: data.question,
      status: "dispatching",
      createdAt: ts,
      updatedAt: ts,
    });
    // The orchestrator service on AWS owns dispatch. This returns as soon as
    // the row exists and the service picks it up on its next tick, so the
    // first poll may show dispatching with 0 agents. That is normal.
    return { inquiryId: id };
  });

export type SynthesisSource = { label: string; url: string };

export type SynthesisView = {
  preamble: string;
  recommendations: {
    company: string;
    title: string;
    body: string;
    confidence: number;
    verdict: string;
    marketCall: string;
    timeframe: string;
    marketLines?: string[];
    sources: SynthesisSource[];
  }[];
  market?: {
    at: string;
    lines: string[];
    byCompany: Record<string, { symbol: string; price: number; change24hPct: number }>;
    source?: "agent-os" | "mirror";
  } | null;
};

const synthesisSchema = z.object({
  preamble: z.string(),
  recommendations: z.array(
    z.object({
      company: z.string(),
      title: z.string(),
      body: z.string(),
      confidence: z.number(),
      verdict: z.string().optional().default("unclear"),
      marketCall: z.string().optional().default(""),
      timeframe: z.string().optional().default(""),
      marketLines: z.array(z.string()).optional().default([]),
      sources: z.array(z.object({ label: z.string(), url: z.string() })),
    }),
  ),
});

const marketSchema = z
  .object({
    at: z.string(),
    lines: z.array(z.string()),
    byCompany: z.record(
      z.string(),
      z.object({ symbol: z.string(), price: z.number(), change24hPct: z.number() }),
    ),
    source: z.enum(["agent-os", "mirror"]).optional().default("mirror"),
  })
  .nullable()
  .optional();

export const getInquiry = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.string().min(3).parse(input))
  .handler(async ({ data: id }) => {
    await ensureSchema();
    let [row] = await db.select().from(inquiries).where(eq(inquiries.id, id));
    if (!row) return null;

    // Read-only poll. The orchestrator service advances the run on its own
    // tick, so this never grades inside the request.

    return {
      id: row.id,
      question: row.question,
      category: row.category,
      geography: row.geography,
      status: row.status as "dispatching" | "collecting" | "grading" | "complete" | "failed",
      agentsMatched: row.agentsMatched,
      claimsReceived: row.claimsReceived,
      sourcesClustered: row.sourcesClustered,
      readout: row.readoutJson ? readoutSchema.parse(JSON.parse(row.readoutJson)) : null,
      /**
       * The intelligence report. Null on runs from before the report pass, so
       * the UI decides what to show rather than assuming it is there. A
       * malformed report reads as absent instead of failing the whole poll.
       */
      report: (() => {
        if (!row.reportJson) return null;
        try {
          return reportSchema.parse(JSON.parse(row.reportJson));
        } catch (err) {
          console.error("report parse failed, serving without it:", err);
          return null;
        }
      })(),
      reportMode: row.reportMode ?? null,
      synthesis: row.synthesisJson
        ? ({
            ...(synthesisSchema.parse(JSON.parse(row.synthesisJson)) as SynthesisView),
            market: row.marketJson ? marketSchema.parse(JSON.parse(row.marketJson)) : null,
          } as SynthesisView)
        : null,
      error: row.error,
      windowSeconds: SOURCING_WINDOW_SECONDS,
      windowClosesAt: row.windowClosesAt,
      dispatchedAt: row.dispatchedAt,
    };
  });

const runsQuerySchema = z.object({
  identity: z.string().min(3).max(120),
});

// A run older than this is considered abandoned (crashed cycle), never
// resumable. The sourcing window is 5 min; a completed cycle is well under
// 15. Serverless cold-starts can't exceed this either.
const ACTIVE_RUN_WINDOW_MS = 15 * 60 * 1000;

function isActiveStatus(status: string): boolean {
  return status === "dispatching" || status === "collecting" || status === "grading";
}
function isResumable(status: string, createdAt: string | null): boolean {
  return (
    isActiveStatus(status) &&
    !!createdAt &&
    Date.now() - Date.parse(createdAt) < ACTIVE_RUN_WINDOW_MS
  );
}

/**
 * Run history for a signed-in workspace — the durable record. Runs are
 * owned by the account server-side; finished readouts additionally carry
 * their 0G Storage anchor, so nothing depends on any one browser.
 */
export const listMyRuns = createServerFn({ method: "POST" })
  .validator((input: unknown) => runsQuerySchema.parse(input))
  .handler(async ({ data }) => {
    await ensureSchema();
    const rows = await db
      .select()
      .from(inquiries)
      .where(eq(inquiries.identity, data.identity))
      .orderBy(desc(inquiries.createdAt))
      .limit(25);
    return rows.map((row) => ({
      id: row.id,
      question: row.question,
      status: row.status as "dispatching" | "collecting" | "grading" | "complete" | "failed",
      createdAt: row.createdAt,
      claimsReceived: row.claimsReceived ?? 0,
      sourcesClustered: row.sourcesClustered ?? 0,
      complete: row.status === "complete",
      active: isResumable(row.status, row.createdAt),
      error: row.error,
    }));
  });

/** The workspace's most recent in-flight run, if any (resume after refresh / device switch). */
export const latestActiveRun = createServerFn({ method: "POST" })
  .validator((input: unknown) => runsQuerySchema.parse(input))
  .handler(async ({ data }) => {
    await ensureSchema();
    const [row] = await db
      .select()
      .from(inquiries)
      .where(eq(inquiries.identity, data.identity))
      .orderBy(desc(inquiries.createdAt))
      .limit(1);
    if (!row) return null;
    if (!isResumable(row.status, row.createdAt)) return null;
    return { id: row.id };
  });

export const listLiveAgents = createServerFn({ method: "POST" }).handler(async () => {
  await ensureSchema();
  const rows = await db.select().from(agents).orderBy(desc(agents.createdAt));
  return rows.map((a) => ({
    id: a.id,
    name: a.name,
    specialty: a.specialty,
    wallet: `${a.wallet.slice(0, 6)}…${a.wallet.slice(-4)}`,
    status: a.status,
    reliability: a.reliability,
    // ERC-7857 identity pointer ("0x7857:<tokenId>") once minted.
    agenticId: a.agenticId,
    connectedAt: a.createdAt,
  }));
});

const supplySchema = z.object({
  name: z.string().min(2),
  markets: z.array(z.string()).default([]),
  targets: z.array(z.string()).default([]),
  identity: z.string().min(1).max(160).optional(),
});

export const addSupplyRecord = createServerFn({ method: "POST" })
  .validator((input: unknown) => supplySchema.parse(input))
  .handler(async ({ data }) => {
    await ensureSchema();
    const id = newId("SUP");
    await db.insert(supplyRecords).values({
      id,
      name: data.name,
      identity: data.identity ?? null,
      marketsJson: JSON.stringify(data.markets),
      targetsJson: JSON.stringify(data.targets),
      createdAt: nowIso(),
    });
    return { id };
  });

export const listSupplyRecords = createServerFn({ method: "POST" })
  .validator((input: unknown) => supplySchema.pick({ identity: true }).parse(input))
  .handler(async ({ data }) => {
    await ensureSchema();
    if (!data.identity) return [];
    const rows = await db
      .select()
      .from(supplyRecords)
      .where(eq(supplyRecords.identity, data.identity))
      .orderBy(desc(supplyRecords.createdAt));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      markets: JSON.parse(r.marketsJson) as string[],
      targets: JSON.parse(r.targetsJson) as string[],
    }));
  });
