/**
 * Orchestrator smoke test — runs a full inquiry lifecycle against the live DB:
 * dispatch → sample connector sources → submits → grading → readout.
 *
 *   bun run scripts/smoke-inquiry.ts
 */
import { db, ensureSchema, nowIso, newId } from "../src/lib/db";
import { inquiries, evidenceRecords, opportunities } from "../src/lib/db/schema";
import { runInquiry } from "../src/lib/orchestrator/run";
import { eq } from "drizzle-orm";

await ensureSchema();
const id = newId("INQ");
const ts = nowIso();
await db.insert(inquiries).values({
  id,
  question:
    process.argv[2] ??
    "I have 5,000 TVs to sell in Nigeria. Find hospitality companies becoming likely to need them.",
  status: "dispatching",
  createdAt: ts,
  updatedAt: ts,
});
console.log("inquiry created:", id);

await runInquiry(id, "http://localhost:8081/api/claims/submit");

const [row] = await db.select().from(inquiries).where(eq(inquiries.id, id));
console.log("status:", row?.status);
console.log("agents matched:", row?.agentsMatched);
console.log("claims received:", row?.claimsReceived);
console.log("source clusters:", row?.sourcesClustered);
console.log("error:", row?.error);
console.log("readout:", row?.readoutJson);

// Give fire-and-forget 0G anchors time to settle before exiting.
console.log("waiting for 0G anchors…");
for (let i = 0; i < 90; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const ev = await db.select().from(evidenceRecords).where(eq(evidenceRecords.inquiryId, id));
  const [iq] = await db.select().from(inquiries).where(eq(inquiries.id, id));
  const opps = await db.select().from(opportunities);
  const oppForCycle = opps.filter((o) => o.inquiryId === id);
  const anchored = ev.filter((e) => e.anchorRoot);
  const oppsAnchored = oppForCycle.filter((o) => o.anchorRoot);
  if (
    ev.length > 0 &&
    anchored.length === ev.length &&
    iq?.readoutAnchorRoot &&
    oppForCycle.length > 0 &&
    oppsAnchored.length === oppForCycle.length
  ) {
    console.log(
      "evidence anchors:",
      anchored.map((e) => `${e.id} → ${e.anchorRoot!.slice(0, 18)}…`),
    );
    console.log(
      "opportunity anchors:",
      oppsAnchored.map((o) => `${o.company} → ${o.anchorRoot!.slice(0, 18)}…`),
    );
    console.log(
      "readout anchor:",
      iq.readoutAnchorRoot?.slice(0, 18) + "…",
      iq.readoutAnchorTx?.slice(0, 18) + "…",
    );
    break;
  }
}
process.exit(0);
