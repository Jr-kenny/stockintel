import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { db, ensureSchema } from "@/lib/db";
import {
  agents,
  claims,
  evidenceRecords,
  inquiries,
  opportunities,
  settlements,
  supplyRecords,
} from "@/lib/db/schema";
import { desc, eq, inArray } from "drizzle-orm";

/**
 * Live workspace data — every /app page reads through these instead of
 * demo-data.ts. Shapes mirror the old demo exports so existing layouts
 * render unchanged; every value comes from the real orchestrator database.
 *
 * Fields the schema does not carry (delta, window, size…) are rendered as
 * honest placeholders rather than invented numbers.
 */

export type Status = "verified" | "flagged" | "open";

export const statusText: Record<Status, string> = {
  verified: "text-verified",
  flagged: "text-flag",
  open: "text-signal",
};

export const statusLabel: Record<Status, string> = {
  verified: "VERIFIED",
  flagged: "CONTRADICTED",
  open: "TRACKING",
};

export type EvidenceItem = {
  id: string;
  company: string;
  claim: string;
  source: string;
  sourceType: string;
  agent: string;
  observed: string;
  status: Status;
  note?: string | undefined;
};

export type OpportunityView = {
  id: string;
  company: string;
  location: string;
  industry: string;
  need: string;
  confidence: number;
  delta: number;
  window: string;
  size: string;
  status: Status;
  state: "new" | "watching" | "converted" | "expired";
  summary: string;
  reasons: string[];
  agents: string[];
  evidenceIds: string[];
  contradiction?: string | undefined;
  timeline: { period: string; event: string }[];
  otherNeeds: { need: string; confidence: number }[];
  events: string[];
};

export type SupplyView = {
  id: string;
  name: string;
  detail: { label: string; value: string }[];
  markets: string[];
  targets: string[];
  matches: number;
  highConfidence: number;
};

export type AgentRow = {
  name: string;
  type: "Prime" | "Independent";
  specialty: string;
  endpoint: string;
  wallet: string;
  agenticId: string | null;
  status: string;
  reliability: number;
  connectedAt: string;
  evidence: number;
  unique: number;
  earnedUsd: number;
  paidOg: number;
};

export type ContributionTier = "discovery" | "confirmation" | "duplication";

export type ContributionRow = {
  id: string;
  agent: string;
  claim: string;
  tier: ContributionTier;
  weight: number;
  dims: {
    relevance: number;
    quality: number;
    independence: number;
    reliability: number;
    impact: number;
  };
  inquiry: string;
};

function hostOf(source: string): string {
  try {
    return new URL(source).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function agentNameMap(): Promise<Map<string, string>> {
  const rows = await db.select().from(agents);
  return new Map(rows.map((a) => [a.id, a.name]));
}

const identitySchema = z.object({ identity: z.string().min(1).max(160).optional() });

/** Inquiry ids owned by an identity. Empty when signed out — nothing leaks. */
async function inquiryIdsFor(identity: string | undefined): Promise<string[]> {
  if (!identity) return [];
  const rows = await db
    .select({ id: inquiries.id })
    .from(inquiries)
    .where(eq(inquiries.identity, identity));
  return rows.map((r) => r.id);
}

export const listEvidenceLive = createServerFn({ method: "POST" })
  .validator((input: unknown) => identitySchema.parse(input))
  .handler(async ({ data }): Promise<EvidenceItem[]> => {
    await ensureSchema();
    const ids = await inquiryIdsFor(data.identity);
    if (ids.length === 0) return [];
    const [rows, names] = await Promise.all([
      db
        .select()
        .from(evidenceRecords)
        .where(inArray(evidenceRecords.inquiryId, ids))
        .orderBy(desc(evidenceRecords.createdAt))
        .limit(200),
      agentNameMap(),
    ]);
    return rows.map((e) => ({
      id: e.id,
      company: e.company,
      claim: e.claim,
      source: e.source,
      sourceType:
        e.sourceType === "agent submission" && hostOf(e.source)
          ? `news · ${hostOf(e.source)}`
          : e.sourceType,
      agent: names.get(e.agent) ?? e.agent,
      observed: e.observed,
      status: e.status === "flagged" ? "flagged" : "verified",
      ...(e.note ? { note: e.note } : {}),
    }));
  });

export const listOpportunitiesLive = createServerFn({ method: "POST" })
  .validator((input: unknown) => identitySchema.parse(input))
  .handler(async ({ data }): Promise<OpportunityView[]> => {
    await ensureSchema();
    const ids = await inquiryIdsFor(data.identity);
    if (ids.length === 0) return [];
    const rows = await db
      .select()
      .from(opportunities)
      .where(inArray(opportunities.inquiryId, ids))
      .orderBy(desc(opportunities.createdAt));
    return rows.map((o) => ({
      id: o.id,
      company: o.company,
      location: o.location ?? "—",
      industry: o.industry ?? "—",
      need: o.need,
      confidence: Math.round(o.confidence),
      delta: 0,
      window: o.window ?? "—",
      size: o.size ?? "—",
      status: o.status === "verified" ? "verified" : "open",
      state: o.status === "verified" ? "converted" : "watching",
      summary: o.summary,
      reasons: [],
      agents: [],
      evidenceIds: JSON.parse(o.evidenceIdsJson || "[]") as string[],
      timeline: [],
      otherNeeds: [],
      events: [],
    }));
  },
);

const idSchema = z.object({ id: z.string().min(2), identity: z.string().min(1).max(160).optional() });

export const getOpportunityLive = createServerFn({ method: "POST" })
  .validator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data }): Promise<(OpportunityView & { evidence: EvidenceItem[] }) | null> => {
    await ensureSchema();
    const [row] = await db.select().from(opportunities).where(eq(opportunities.id, data.id));
    if (!row) return null;
    // Ownership: the originating inquiry must belong to the requester.
    const [inquiry] = await db
      .select({ identity: inquiries.identity })
      .from(inquiries)
      .where(eq(inquiries.id, row.inquiryId));
    if (!data.identity || inquiry?.identity !== data.identity) return null;

    // Evidence bound explicitly to this opportunity, else everything the
    // originating cycle recorded for the same company.
    let evRows = (() => null) as unknown as (typeof evidenceRecords.$inferSelect)[] | null;
    evRows = [];
    const evIds = JSON.parse(row.evidenceIdsJson || "[]") as string[];
    if (evIds.length > 0) {
      evRows = await db.select().from(evidenceRecords).where(inArray(evidenceRecords.id, evIds));
    }
    if (evRows!.length === 0 && row.inquiryId) {
      const all = await db
        .select()
        .from(evidenceRecords)
        .where(eq(evidenceRecords.inquiryId, row.inquiryId));
      evRows = all.filter((e) => e.company.toLowerCase() === row.company.toLowerCase());
    }

    // Timeline built from the cycle history that touched this company.
    const cycles = await db
      .select()
      .from(inquiries)
      .where(eq(inquiries.id, row.inquiryId))
      .orderBy(desc(inquiries.createdAt))
      .limit(5);
    const claimRows = await db.select().from(claims).where(eq(claims.company, row.company));

    const names = await agentNameMap();
    const contributors = Array.from(new Set(claimRows.map((c) => c.agentId)));

    const view: OpportunityView & { evidence: EvidenceItem[] } = {
      id: row.id,
      company: row.company,
      location: row.location ?? "—",
      industry: row.industry ?? "—",
      need: row.need,
      confidence: Math.round(row.confidence),
      delta: 0,
      window: row.window ?? "—",
      size: row.size ?? "—",
      status: row.status === "verified" ? "verified" : "open",
      state: row.status === "verified" ? "converted" : "watching",
      summary: row.summary,
      reasons: claimRows
        .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
        .slice(0, 3)
        .map((c) => c.claim),
      agents: contributors.map((id) => names.get(id) ?? id),
      evidenceIds: JSON.parse(row.evidenceIdsJson || "[]") as string[],
      timeline: cycles
        .filter((c) => c.createdAt)
        .map((c) => ({
          period: c.createdAt.slice(0, 10),
          event: c.readoutJson
            ? `Cycle ${c.id} completed · ${JSON.parse(c.readoutJson).length} companies in readout`
            : `Cycle ${c.id} · ${c.status}`,
        })),
      otherNeeds: [],
      events: [],
      evidence: (evRows ?? []).map((e) => ({
        id: e.id,
        company: e.company,
        claim: e.claim,
        source: e.source,
        sourceType:
          e.sourceType === "agent submission" && hostOf(e.source)
            ? `news · ${hostOf(e.source)}`
            : e.sourceType,
        agent: names.get(e.agent) ?? e.agent,
        observed: e.observed,
        status: e.status === "flagged" ? "flagged" : "verified",
        ...(e.note ? { note: e.note } : {}),
      })),
    };
    return view;
  });

export const listSupplyLive = createServerFn({ method: "POST" })
  .validator((input: unknown) => identitySchema.parse(input))
  .handler(async ({ data }): Promise<SupplyView[]> => {
    await ensureSchema();
    if (!data.identity) return [];
    const ids = await inquiryIdsFor(data.identity);
    const rows = await db
      .select()
      .from(supplyRecords)
      .where(eq(supplyRecords.identity, data.identity))
      .orderBy(desc(supplyRecords.createdAt));
    const opps =
      ids.length === 0
        ? []
        : await db
            .select()
            .from(opportunities)
            .where(inArray(opportunities.inquiryId, ids));

    return rows.map((r) => {
      const detail = JSON.parse(r.detailJson || "[]") as { label: string; value: string }[];
      const markets = JSON.parse(r.marketsJson || "[]") as string[];
      const targets = JSON.parse(r.targetsJson || "[]") as string[];
      // Real matching: how many live opportunities touch this supply's targets.
      const matched = opps.filter((o) =>
        targets.some(
          (t) =>
            o.summary.toLowerCase().includes(t.toLowerCase()) ||
            o.need.toLowerCase().includes(t.toLowerCase()),
        ),
      );
      return {
        id: r.id,
        name: r.name,
        detail,
        markets,
        targets,
        matches: matched.length,
        highConfidence: matched.filter((o) => o.confidence >= 70).length,
      };
    });
  });

export const listAgentsLive = createServerFn({ method: "POST" }).handler(
  async (): Promise<AgentRow[]> => {
    await ensureSchema();
    const [agentRows, claimRows, settleRows] = await Promise.all([
      db.select().from(agents).orderBy(desc(agents.createdAt)),
      db.select().from(claims),
      db.select().from(settlements),
    ]);

    return agentRows.map((a) => {
      const graded = claimRows.filter((c) => c.agentId === a.id && c.weight != null);
      const hosts = new Set(
        graded.flatMap((c) =>
          (JSON.parse(c.evidenceJson || "[]") as { source: string }[])
            .map((e) => hostOf(e.source))
            .filter(Boolean),
        ),
      );
      const paid = settleRows.filter((s) => s.agentId === a.id);
      return {
        name: a.name,
        type:
          a.id.startsWith("AGT-PRIME") || a.endpoint.includes("prime-layer")
            ? "Prime"
            : "Independent",
        specialty: a.specialty || "general signal sweep",
        endpoint: a.endpoint,
        wallet: `${a.wallet.slice(0, 6)}…${a.wallet.slice(-4)}`,
        agenticId: a.agenticId,
        status: a.status,
        reliability: Math.round(a.reliability * 100) / 100,
        connectedAt: a.createdAt,
        evidence: graded.length,
        unique:
          graded.length > 0
            ? Math.min(
                100,
                Math.round(
                  (hosts.size /
                    Math.max(
                      graded.reduce(
                        (s, c) => s + (JSON.parse(c.evidenceJson || "[]") as unknown[]).length,
                        1,
                      ),
                      1,
                    )) *
                    100,
                ),
              )
            : 0,
        earnedUsd: Math.round(paid.reduce((s, r) => s + r.amountUsd, 0) * 100) / 100,
        paidOg: Math.round(paid.reduce((s, r) => s + (r.paidOg ?? 0), 0) * 1e6) / 1e6,
      };
    });
  },
);

export const listContributionsLive = createServerFn({ method: "POST" }).handler(
  async (): Promise<ContributionRow[]> => {
    await ensureSchema();
    const [rows, names] = await Promise.all([
      db.select().from(claims).orderBy(desc(claims.submittedAt)).limit(60),
      agentNameMap(),
    ]);
    return rows
      .filter((r) => r.tier != null)
      .map((r) => ({
        id: `CTB-${r.id}`,
        agent: names.get(r.agentId) ?? r.agentId,
        claim: r.claim,
        tier: (r.tier ?? "duplication") as ContributionRow["tier"],
        dims: JSON.parse(
          r.dimsJson || '{"relevance":1,"quality":0,"independence":0,"reliability":0.8,"impact":0}',
        ) as ContributionRow["dims"],
        inquiry: r.inquiryId,
        weight: r.weight ?? 0,
      }));
  },
);
