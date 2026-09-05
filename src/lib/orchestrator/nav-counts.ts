import { createServerFn } from "@tanstack/react-start";
import { count, eq } from "drizzle-orm";

/**
 * Live sidebar counts — replaces the old hardcoded "3"/"18"/"6" notes.
 * One round of count queries; the UI degrades to no badge if this fails.
 */
export const getNavCounts = createServerFn({ method: "POST" }).handler(async () => {
  try {
    const { db, ensureSchema } = await import("@/lib/db");
    const { agents, supplyRecords, evidenceRecords } = await import("@/lib/db/schema");
    await ensureSchema();
    const [supply] = await db.select({ n: count() }).from(supplyRecords);
    const [evidence] = await db
      .select({ n: count() })
      .from(evidenceRecords)
      .where(eq(evidenceRecords.status, "verified"));
    const [agentsRow] = await db
      .select({ n: count() })
      .from(agents)
      .where(eq(agents.status, "online"));
    return {
      supply: Number(supply?.n ?? 0),
      evidence: Number(evidence?.n ?? 0),
      agents: Number(agentsRow?.n ?? 0),
    };
  } catch {
    return { supply: 0, evidence: 0, agents: 0 };
  }
});
