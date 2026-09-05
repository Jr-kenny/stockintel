/**
 * Smoke test for the Sibyl memory layer. Run: bun scripts/memory-smoke.ts
 * Simulates two inquiry cycles 1 second apart ("two customers, similar ask")
 * and verifies that cycle 2 recalls what cycle 1 remembered.
 */
process.env["DATABASE_URL"] = "file:./.smoke-memory.db";

import { unlinkSync, existsSync } from "node:fs";
for (const f of [".smoke-memory.db", ".smoke-memory.db-wal", ".smoke-memory.db-shm"]) {
  if (existsSync(f)) unlinkSync(f); // fresh db every run — cold start must be cold
}

async function main() {
  const { ensureSchema } = await import("../src/lib/db");
  const { recallForInquiry, buildWarmBrief, rememberCycle, emptyRecall } =
    await import("../src/lib/memory");
  const { client } = await import("../src/lib/db");

  console.log("== ensure schema ==");
  await ensureSchema();

  // ── Cycle 1: cold start ──────────────────────────────────────────────────
  console.log("\n== CYCLE 1 (cold): 'I have 5000 TCL TVs available in Nigeria, min order 20' ==");
  const r1 = await recallForInquiry("I have 5000 TCL TVs available in Nigeria, min order 20");
  console.log("recall:", JSON.stringify(r1));
  console.assert(
    JSON.stringify(r1) === JSON.stringify(emptyRecall()),
    "cold start should recall nothing",
  );

  await rememberCycle({
    inquiryId: "INQ-001",
    question: "I have 5000 TCL TVs available in Nigeria, min order 20",
    category: null,
    geography: "nigeria",
    graded: [
      {
        agentId: "AGT-hospitality",
        company: "Eko Atlantic Hotels Ltd",
        claim: "Opening 150-room tower in Victoria Island, furnishing phase starts Q4",
        confidence: 0.71,
        evidence: [
          {
            item: "Commercial lease signed for 150-room property",
            source: "https://lagosstate.gov.ng/planning/permits/eko-atlantic-2026",
            observed: "2026-08-17",
          },
        ],
        tier: "discovery",
        weight: 0.62,
      },
      {
        agentId: "AGT-construction",
        company: "Eko Atlantic Hotels Ltd",
        claim: "37 hospitality job openings posted this week",
        confidence: 0.66,
        evidence: [
          {
            item: "Job postings spike: housekeeping, front desk, F&B",
            source: "https://jobs.example.com/eko-atlantic-hiring",
            observed: "2026-08-18",
          },
        ],
        tier: "confirmation",
        weight: 0.41,
      },
    ],
  });

  // ── Cycle 2: warm start, 2 weeks later ───────────────────────────────────
  console.log("\n== CYCLE 2 (warm): 'who needs 5000 TVs in Lagos Nigeria?' ==");
  const r2 = await recallForInquiry("who needs 5000 TVs in Lagos Nigeria?");
  console.log(
    "similar past:",
    r2.similarPast.map((s) => `${s.inquiryId} overlap=${s.overlap}%`),
  );
  console.log(
    "known claims:",
    r2.knownClaims.map((c) => `${c.company} @ ${c.bestConfidence}%`),
  );
  console.log("warm brief:", buildWarmBrief(r2));

  if (r2.similarPast.length === 0) throw new Error("FAIL: expected similarity match");
  if (!r2.knownClaims.some((c) => c.company === "Eko Atlantic Hotels Ltd"))
    throw new Error("FAIL: expected known claim");

  // ── Verify stores directly ──────────────────────────────────────────────
  console.log("\n== store contents ==");
  for (const t of [
    "memory_sources",
    "memory_claims",
    "memory_agent_history",
    "memory_companies",
    "memory_inquiries",
    "memory_followups",
  ]) {
    const res = await client.execute(`SELECT COUNT(*) as n FROM ${t}`);
    console.log(`${t}: ${res.rows[0]?.n} rows`);
  }

  const fu = await client.execute("SELECT company, agent_id, due_at FROM memory_followups");
  console.log("scheduled follow-up:", fu.rows[0]);

  console.log("\n✅ SMOKE TEST PASSED — memory remembers across cycles");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ SMOKE TEST FAILED:", e);
    process.exit(1);
  });
