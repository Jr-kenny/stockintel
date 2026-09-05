/**
 * LIVE anchor test — commits a real record to Base Sepolia.
 * Uses BASE_SIGNER_KEY from .env. Costs a fraction of a cent.
 * Run: bun scripts/anchor-live.ts
 */
import { anchorRecord } from "../src/lib/base/evidence-anchor";
import { baseConfig } from "../src/lib/base/config";

async function main() {
  const cfg = baseConfig();
  console.log(`network=${cfg.network} chain=${cfg.chainId} signer=${cfg.walletAddress}`);
  if (!cfg.live) {
    console.error("BASE_SIGNER_KEY not set");
    process.exit(1);
  }

  const result = await anchorRecord({
    kind: "evidence",
    id: `LIVE-${Date.now().toString(36)}`,
    agent: "prime-orchestrator",
    claim: "PrimeBaseLayer first live anchor on Base Sepolia — Sibyl build window",
    confidence: 1,
    evidence: [
      {
        item: "Live verification anchor",
        source: "prime-base://live-test",
        observed: new Date().toISOString().slice(0, 10),
      },
    ],
    observedAt: new Date().toISOString().slice(0, 10),
  });

  console.log("mode:      ", result.mode);
  console.log("root:      ", result.rootHash);
  console.log("tx:        ", result.txHash);
  console.log("explorer:  ", result.explorerUrl);
  if (result.mode !== "live") throw new Error("expected live mode");
  console.log("\n✅ LIVE ANCHOR CONFIRMED ON BASE SEPOLIA");
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
