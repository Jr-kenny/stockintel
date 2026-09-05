/**
 * Backfill on-chain anchors for demand-graph opportunities that predate
 * opportunity anchoring. Idempotent — skips rows that already carry a root.
 *
 *   bun run scripts/backfill-opportunity-anchors.ts
 */
import { db, ensureSchema, nowIso } from "../src/lib/db";
import { opportunities } from "../src/lib/db/schema";
import { eq, isNull } from "drizzle-orm";
import { anchorRecord } from "../src/lib/base/evidence-anchor";

await ensureSchema();

const pending = await db.select().from(opportunities).where(isNull(opportunities.anchorRoot));
console.log(`${pending.length} opportunities without an anchor`);

for (const row of pending) {
  try {
    const result = await anchorRecord({
      kind: "opportunity",
      id: row.id,
      agent: "prime-orchestrator",
      claim: `${row.company}: ${row.need} @ ${Math.round(row.confidence)}% (${row.status})`,
      confidence: row.confidence,
      evidence: [
        {
          item: row.summary,
          source: `prime-layer://opportunity/${row.id}`,
          observed: nowIso().slice(0, 10),
        },
      ],
      ...(row.inquiryId ? { inquiry: row.inquiryId } : {}),
      observedAt: nowIso().slice(0, 10),
    });
    await db
      .update(opportunities)
      .set({
        anchorRoot: result.rootHash,
        ...(result.txHash ? { anchorTx: result.txHash } : {}),
      })
      .where(eq(opportunities.id, row.id));
    console.log(`✓ ${row.company.slice(0, 40)} → ${result.rootHash.slice(0, 18)}…`);
  } catch (err) {
    console.error(`✗ ${row.company.slice(0, 40)}:`, err instanceof Error ? err.message : err);
  }
}

console.log("backfill done.");
process.exit(0);
