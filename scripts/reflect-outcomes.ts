/**
 * Outcome reflection — close the intelligence loop.
 *
 * For past assessments old enough to judge (48h+), compare what the thesis
 * said against what price actually did, and write the lesson into Sibyl
 * memory (claim status confirmed/expired). Mechanics only: the rule below
 * records outcomes, it does not grade analyst skill.
 *
 *   bun scripts/reflect-outcomes.ts [--apply]
 *
 * Without --apply it prints what it WOULD record. Nothing writes by default.
 */

import { and, desc, eq, isNotNull, lt } from "drizzle-orm";
import { db, ensureSchema, nowIso } from "../src/lib/db/index.ts";
import { inquiries, memoryClaims } from "../src/lib/db/schema.ts";
import { companyToTicker, getQuotes } from "../src/lib/binance/market.ts";

/** Legacy per-company thesis shape, kept for runs recorded before the report pass. */
type Synthesis = {
  recommendations?: { company: string; verdict?: unknown }[];
};

const REFLECT_AFTER_MS = 48 * 3600 * 1000;
const OUTCOME_BAND_PCT = 3; // moves inside this band read as noise
const DRY = !process.argv.includes("--apply");

type Verdict = "underpriced" | "priced" | "unclear";

function judge(
  verdict: Verdict,
  driftPct: number,
): { outcome: "supported" | "contradicted" | "inconclusive"; note: string } {
  const big = Math.abs(driftPct) > OUTCOME_BAND_PCT;
  if (verdict === "unclear") {
    return { outcome: "inconclusive", note: `moved ${driftPct.toFixed(1)}%; thesis was unclear, outcome recorded only` };
  }
  if (verdict === "underpriced") {
    if (driftPct > OUTCOME_BAND_PCT)
      return { outcome: "supported", note: `rose ${driftPct.toFixed(1)}% after an underpriced call` };
    if (driftPct < -OUTCOME_BAND_PCT)
      return { outcome: "contradicted", note: `fell ${driftPct.toFixed(1)}% after an underpriced call` };
    return { outcome: "inconclusive", note: `moved ${driftPct.toFixed(1)}%, inside the noise band` };
  }
  // verdict === "priced"
  if (!big) return { outcome: "supported", note: `held within ±${OUTCOME_BAND_PCT}% after a priced call` };
  return { outcome: "contradicted", note: `moved ${driftPct.toFixed(1)}% after a priced call, the move was missed` };
}

async function main() {
  await ensureSchema();
  const cutoff = new Date(Date.now() - REFLECT_AFTER_MS).toISOString();
  const rows = await db
    .select()
    .from(inquiries)
    .where(and(eq(inquiries.status, "complete"), isNotNull(inquiries.marketJson), lt(inquiries.createdAt, cutoff)))
    .orderBy(desc(inquiries.createdAt))
    .limit(25);

  if (rows.length === 0) {
    console.log("Nothing due for reflection. Assessments need 48h before judging.");
    return;
  }

  for (const row of rows) {
    let market: { at: string; byCompany: Record<string, { price: number }> };
    let synthesis: Synthesis;
    try {
      market = JSON.parse(row.marketJson!);
      synthesis = JSON.parse(row.synthesisJson ?? '{"recommendations":[]}');
    } catch {
      continue;
    }
    const recs = (synthesis.recommendations ?? []).filter(
      (r) => typeof (r as { verdict?: unknown }).verdict === "string",
    );
    if (recs.length === 0) continue;

    // one quote fetch per ticker across this inquiry's recommendations
    const tickers = new Set<string>();
    const recTicker = new Map<string, string>();
    for (const r of recs) {
      const t = companyToTicker(r.company);
      if (t) {
        tickers.add(t);
        recTicker.set(r.company, t);
      }
    }
    if (tickers.size === 0) continue;
    const quotes = await getQuotes([...tickers]);
    const priceNow = new Map(quotes.filter((q) => q.price !== null).map((q) => [q.ticker, q.price as number]));

    for (const r of recs) {
      const ticker = recTicker.get(r.company);
      const then = ticker ? market.byCompany[r.company]?.price ?? market.byCompany[ticker]?.price : undefined;
      const now = ticker ? priceNow.get(ticker) : undefined;
      if (ticker === undefined || then === undefined || now === undefined || then <= 0) continue;
      const driftPct = ((now - then) / then) * 100;
      const verdict = (r as { verdict: Verdict }).verdict;
      const { outcome, note } = judge(verdict, driftPct);
      const days = ((Date.now() - Date.parse(row.createdAt)) / 86400000).toFixed(1);
      console.log(
        `[${row.id}] ${r.company} (${ticker}) verdict=${verdict} then=$${then.toFixed(2)} now=$${now.toFixed(2)} drift=${driftPct >= 0 ? "+" : ""}${driftPct.toFixed(1)}% over ${days}d → ${outcome}. ${note}.`,
      );
      if (DRY || outcome === "inconclusive") continue;
      const status = outcome === "supported" ? "confirmed" : "expired";
      const existing = await db
        .select()
        .from(memoryClaims)
        .where(eq(memoryClaims.company, r.company))
        .orderBy(desc(memoryClaims.lastSeen))
        .limit(1);
      if (existing.length > 0) {
        await db
          .update(memoryClaims)
          .set({ status, lastSeen: nowIso() })
          .where(eq(memoryClaims.id, existing[0]!.id));
        console.log(`  memory: claim #${existing[0]!.id} → ${status}`);
      }
    }
  }
  if (DRY) console.log("\nDry run. Re-run with --apply to write to memory.");
}

await main();
