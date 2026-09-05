import { db, ensureSchema, nowIso, newId } from "../src/lib/db/index.ts";
import { inquiries } from "../src/lib/db/schema.ts";
import { runInquiry, tryGradeIfReady } from "../src/lib/orchestrator/run.ts";
import { eq } from "drizzle-orm";

const SUBMIT = process.env["PUBLIC_SUBMIT_URL"] ?? "http://localhost:8080";
const QUESTION =
  process.argv[2] ??
  "Watch NVDA: what is happening in the world that could materially change its value?";

await ensureSchema();
const id = newId("INQ");
const ts = nowIso();
await db.insert(inquiries).values({
  id,
  question: QUESTION,
  status: "dispatching",
  createdAt: ts,
  updatedAt: ts,
});
console.log("FULLCALL INQ: " + id + " via " + SUBMIT);
await runInquiry(id, `${SUBMIT}/api/claims/submit`);

const deadline = Date.now() + 16 * 60 * 1000;
let done = false;
while (Date.now() < deadline && !done) {
  await new Promise((r) => setTimeout(r, 15000));
  const [row] = await db.select().from(inquiries).where(eq(inquiries.id, id));
  if (!row) break;
  console.log(
    `POLL status=${row.status} claims=${row.claimsReceived} clusters=${row.sourcesClustered} agents=${row.agentsMatched}`,
  );
  if (row.status === "collecting" || row.status === "grading") {
    try {
      await tryGradeIfReady(id);
    } catch (e) {
      console.log("grade trigger err: " + String((e as Error)?.message ?? e).slice(0, 120));
    }
  }
  if (row.status === "complete" || row.status === "failed") done = true;
}

const [final] = await db.select().from(inquiries).where(eq(inquiries.id, id));
console.log("FINAL status=" + final?.status + " error=" + (final?.error ?? "none"));
console.log("agentsMatched=" + final?.agentsMatched + " claims=" + final?.claimsReceived + " clusters=" + final?.sourcesClustered + " mode=" + (final?.gradeMode ?? "?"));
if (final?.readoutJson) {
  const readout = JSON.parse(final.readoutJson as string);
  console.log("READOUT entries=" + readout.length);
  for (const e of readout.slice(0, 10)) {
    console.log(`  RO ${e.company} | conf=${e.confidence} claims=${e.claims} indep=${e.independentSources}`);
  }
}
if (final?.synthesisJson) {
  const s = JSON.parse(final.synthesisJson as string);
  console.log("PREAMBLE: " + (s.preamble ?? "").slice(0, 250));
  for (const r of s.recommendations ?? []) {
    console.log(`  SYN ${r.company} | conf=${r.confidence} verdict=${r.verdict} time=${r.timeframe} sources=${(r.sources ?? []).length}`);
    console.log(`     market: ${(r.marketCall ?? "").slice(0, 180)}`);
  }
}
process.exit(0);
