/**
 * Pay-per-run smoke test — the buyer pays FROM THEIR OWN WALLET:
 *   1. Quote the invoice (exact wei for one run)
 *   2. Buyer's wallet (fresh key, funded by platform) sends native 0G
 *      to the platform wallet
 *   3. submitPaidInquiry verifies the tx on-chain and dispatches
 *   4. Underpayment rejected; same tx reused rejected
 *
 *   BUYER_KEY=0x... (funded test wallet) bun run scripts/smoke-pay-per-run.ts
 */
import { db, ensureSchema, nowIso, newId } from "../src/lib/db";
import { accounts } from "../src/lib/db/schema";
import { eq } from "drizzle-orm";
import { verifyRunPayment, runPriceInvoice } from "../src/lib/orchestrator/credits";
import { baseConfig } from "../src/lib/base/config";

await ensureSchema();

const buyerKey =
  process.env["BUYER_KEY"] ?? "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // throwaway test key
const config = baseConfig();
if (!config.live) throw new Error("BASE_SIGNER_KEY required to fund the buyer");
const { ethers } = await import("ethers");
const provider = new ethers.JsonRpcProvider(config.rpcUrl);
const platform = new ethers.Wallet(config.privateKey!, provider);
const buyer = new ethers.Wallet(buyerKey, provider);

// Fund the buyer with exactly one run's price + gas headroom.
const invoice = await runPriceInvoice();
if (!invoice.wallet) throw new Error("PRIME_PLATFORM_WALLET not set");
console.log(`invoice: $${invoice.usd} → ${ethers.formatEther(BigInt(invoice.amountWei))} ETH`);
const fundTx = await platform.sendTransaction({
  to: await buyer.getAddress(),
  value: BigInt(invoice.amountWei) * 2n + ethers.parseEther("0.0005"),
});
await fundTx.wait();
console.log(
  `✓ buyer funded (${ethers.formatEther(BigInt(invoice.amountWei) + ethers.parseEther("0.00025"))} ETH)`,
);

// 2: buyer pays the platform
const payTx = await buyer.sendTransaction({ to: invoice.wallet, value: BigInt(invoice.amountWei) });
await payTx.wait();
console.log(`✓ buyer paid on-chain: ${payTx.hash.slice(0, 18)}…`);

// 3: server verifies against a fresh account + inquiry
const identity = `smoke-payer-${Date.now()}@example.com`;
const accountId = newId("ACC");
await db.insert(accounts).values({
  id: accountId,
  identity,
  credits: 0,
  freeRunsUsed: FREE_TRIAL_RUNS_PLACEHOLDER(),
  createdAt: nowIso(),
});
const result = await verifyRunPayment(payTx.hash, newId("INQ"), accountId);
if (!result.ok) throw new Error(`verification failed: ${result.error}`);
console.log(`✓ run payment verified (${result.paidNative} ETH)`);

// 4a: underpayment rejected
const underTx = await buyer.sendTransaction({
  to: invoice.wallet,
  value: BigInt(invoice.amountWei) / 2n,
});
await underTx.wait();
const under = await verifyRunPayment(underTx.hash, newId("INQ"), accountId);
if (under.ok) throw new Error("underpayment should have been rejected");
console.log(`✓ underpayment rejected: ${under.error}`);

// 4b: replay rejected
const replay = await verifyRunPayment(payTx.hash, newId("INQ"), accountId);
if (replay.ok) throw new Error("replay should have been rejected");
console.log(`✓ reuse rejected: ${replay.error}`);

// cleanup
await db.delete(accounts).where(eq(accounts.id, accountId));
console.log("\npay-per-run smoke done — all legs passed.");
process.exit(0);

function FREE_TRIAL_RUNS_PLACEHOLDER() {
  return 5;
}
