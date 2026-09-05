/**
 * Base integration smoke test. Run: bun scripts/base-smoke.ts
 * Verifies anchoring (sandbox), settlement math, and payout guards —
 * all without needing a funded signer.
 */
process.env["DATABASE_URL"] = "file:./.smoke-base.db";
import { unlinkSync, existsSync } from "node:fs";
for (const f of [".smoke-base.db", ".smoke-base.db-wal", ".smoke-base.db-shm"]) {
  if (existsSync(f)) unlinkSync(f);
}

async function main() {
  const { baseConfig } = await import("../src/lib/base/config");
  const { anchorRecord, localRoot } = await import("../src/lib/base/evidence-anchor");
  const { buildSettlement } = await import("../src/lib/base/payments");
  const { settleCycle, USDC_BASE } = await import("../src/lib/base/payouts");

  // ── Config defaults ──────────────────────────────────────────────────
  const cfg = baseConfig();
  console.log("network:", cfg.network, "| chain", cfg.chainId, "| live:", cfg.live);
  if (cfg.chainId !== 84532) throw new Error("expected Base Sepolia default");
  if (cfg.live) throw new Error("expected sandbox without BASE_SIGNER_KEY");

  // ── Anchor in sandbox mode ───────────────────────────────────────────
  const record = {
    kind: "evidence" as const,
    id: "EV-smoke-1",
    agent: "AGT-hospitality",
    claim: "Eko Atlantic Hotels Ltd: opening 150-room tower",
    confidence: 0.71,
    evidence: [
      {
        item: "Commercial lease signed",
        source: "https://lagosstate.gov.ng/planning/permits/eko-2026",
        observed: "2026-08-17",
      },
    ],
    observedAt: "2026-08-17",
  };
  const anchored = await anchorRecord(record);
  console.log("anchor:", anchored.mode, anchored.rootHash.slice(0, 18) + "…");
  if (anchored.mode !== "sandbox") throw new Error("expected sandbox anchor");
  if (anchored.rootHash !== localRoot(record)) throw new Error("root mismatch");
  const again = await anchorRecord(record);
  if (again.rootHash !== anchored.rootHash) throw new Error("root not deterministic");

  // Different record → different root
  const other = await anchorRecord({ ...record, id: "EV-smoke-2" });
  if (other.rootHash === anchored.rootHash) throw new Error("different records collided!");

  // ── Settlement math ──────────────────────────────────────────────────
  const { poolUsd, lines } = buildSettlement([
    { agentId: "AGT-a", wallet: "0x1111111111111111111111111111111111111111", weight: 0.62 },
    { agentId: "AGT-b", wallet: "0x2222222222222222222222222222222222222222", weight: 0.41 },
    { agentId: "AGT-c", wallet: "123", weight: 0.2 }, // placeholder → skipped at payout
  ]);
  console.log(
    `pool: $${poolUsd} | lines:`,
    lines.map((l) => `${l.agentId}=$${l.amountUsd}`),
  );
  const sum = lines.reduce((s, l) => s + l.amountUsd, 0);
  if (Math.abs(sum - poolUsd) > 0.02) throw new Error(`lines sum ${sum} != pool ${poolUsd}`);

  // ── Payouts skip cleanly with no signer ──────────────────────────────
  const settled = await settleCycle(
    lines.map((l, i) => ({ rowId: i + 1, agentId: l.agentId, wallet: l.wallet, weight: l.weight })),
  );
  console.log(
    `payouts: attempted=${settled.attempted.length}, skipped=${settled.skipped.length}`,
    `(${settled.skipped[0]?.reason})`,
  );
  if (settled.totalPaidUsd !== 0) throw new Error("nothing should be paid without a key");
  if (settled.skipped.length < 3) throw new Error("expected skips without a signer");

  // Placeholder wallet check
  const { isPlaceholderWallet } = await import("../src/lib/base/wallets");
  if (!isPlaceholderWallet("123")) throw new Error("placeholder guard failed");
  if (isPlaceholderWallet("0x1111111111111111111111111111111111111111")) {
    throw new Error("real wallet flagged as placeholder");
  }

  console.log("\nUSDC contract pinned:", USDC_BASE);

  console.log("\n✅ BASE SMOKE TEST PASSED");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ FAILED:", e);
    process.exit(1);
  });
