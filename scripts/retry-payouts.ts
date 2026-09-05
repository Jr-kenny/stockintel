/**
 * Retry pending Base payouts — sweeps settlement rows that were skipped
 * (dust, low balance) or failed, and re-attempts them.
 *
 *   bun run scripts/retry-payouts.ts            # sweep everything pending
 *   bun run scripts/retry-payouts.ts --dry      # preview only
 *   DRY_RUN=true bun run scripts/retry-payouts.ts
 *
 * Rows already stamped with payout_tx are never touched. Budget for the sweep
 * comes from PRIME_PAYOUT_BUDGET_USD (same as cycles) unless PRIME_RETRY_BUDGET_USD
 * is set. Each retried row is paid at its original weight share of the budget.
 */
import { db, ensureSchema } from "../src/lib/db";
import { settlements } from "../src/lib/db/schema";
import { isNull, and, eq, inArray } from "drizzle-orm";
import { payoutConfig, settleCycle, type PayableLine } from "../src/lib/base/payouts";

await ensureSchema();

const config = payoutConfig();
if (!config.live) {
  console.error("Base payouts not live — set BASE_SIGNER_KEY; unset BASE_PAY_DISABLED to enable.");
  process.exit(1);
}

const dry = process.argv.includes("--dry") || process.env.DRY_RUN === "true";

const pending = await db
  .select()
  .from(settlements)
  .where(and(isNull(settlements.paidNative), isNull(settlements.payoutTx)));
// payout_error is diagnostic, not disqualifying — failed rows are the point.
const retryable = pending;
console.log(`${pending.length} pending payout rows, ${retryable.length} retryable`);

if (retryable.length === 0 || dry) {
  if (dry) {
    for (const r of retryable) console.log(`[dry] would pay ${r.wallet} (weight ${r.weight})`);
  }
  console.log("nothing to do.");
  process.exit(0);
}

// Group by inquiry so each cycle's payroll keeps its own weight proportions.
const byInquiry = new Map<string, typeof retryable>();
for (const r of retryable) {
  const list = byInquiry.get(r.inquiryId) ?? [];
  list.push(r);
  byInquiry.set(r.inquiryId, list);
}

const retryBudget = Number(process.env.PRIME_RETRY_BUDGET_USD) || config.budgetUsd;
let totalPaid = 0;

for (const [inquiryId, rows] of byInquiry) {
  const lines: PayableLine[] = rows.map((r) => ({
    rowId: r.id,
    agentId: r.agentId,
    wallet: r.wallet,
    weight: r.weight,
  }));
  const result = await settleCycle(lines, { budgetUsdOverride: retryBudget });
  for (const a of result.attempted) {
    if (a.txHash) {
      await db
        .update(settlements)
        .set({ paidNative: a.amountUsd, payoutTx: a.txHash, payoutError: null })
        .where(inArray(settlements.id, a.rowIds));
      console.log(
        `✓ ${a.wallet} $${a.amountUsd} (${a.rowIds.length} rows) → ${a.txHash.slice(0, 18)}…`,
      );
      totalPaid += a.amountUsd;
    } else {
      await db
        .update(settlements)
        .set({ payoutError: a.error ?? "unknown payout failure" })
        .where(inArray(settlements.id, a.rowIds));
      console.error(`✗ ${a.wallet}: ${a.error}`);
    }
  }
  for (const s of result.skipped) {
    console.log(`- skipped ${s.wallet}: ${s.reason}`);
  }
}

console.log(`retry sweep done — ${totalPaid.toFixed(2)} USDC paid out (native recorded).`);
process.exit(0);
