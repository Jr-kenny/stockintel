/**
 * Credits system smoke test — exercises the full money path with REAL chain
 * payment:
 *
 *   1. Account created with 5 free runs
 *   2. Free runs consumed 5× (6th attempt → out_of_credits)
 *   3. Platform signer pays itself one run's worth of ETH on Base (real tx)
 *   4. verifyTopupInternal verifies the tx on-chain → credits added
 *   5. Paid run consumes a credit
 *   6. Replay: same txHash rejected
 *
 *   PRIME_PLATFORM_WALLET must be set (or defaults to the signer) and the
 *   signer funded. PRIME_ETH_USD_RATE defaults to 3000 ($/ETH).
 */
import { db, ensureSchema } from "../src/lib/db";
import { accounts } from "../src/lib/db/schema";
import { eq } from "drizzle-orm";
import { consumeRun, verifyTopupInternal, FREE_TRIAL_RUNS } from "../src/lib/orchestrator/credits";
import { baseConfig } from "../src/lib/base/config";

await ensureSchema();

const IDENTITY = "smoke-business@example.com";
// Fresh identity per run so the free-trial count starts at zero.
const identity = `${IDENTITY}-${Date.now()}`;

// 1-2: free runs
for (let i = 0; i < FREE_TRIAL_RUNS; i++) {
  const r = await consumeRun(identity, `INQ-free-${i}`);
  if (!r.ok || r.source !== "free") throw new Error(`free run ${i} failed: ${JSON.stringify(r)}`);
}
const sixth = await consumeRun(identity, "INQ-free-6");
if (sixth.ok) throw new Error("sixth run should have been blocked");
console.log(`✓ ${FREE_TRIAL_RUNS} free runs consumed, 6th blocked (${sixth.reason})`);

// 3: real payment — platform signer sends itself one run price in ETH on Base
const config = baseConfig();
if (!config.live) throw new Error("BASE_SIGNER_KEY required for the payment leg");
const { ethers } = await import("ethers");
const provider = new ethers.JsonRpcProvider(config.rpcUrl);
const signer = new ethers.Wallet(config.privateKey!, provider);
const rate = Number(process.env["PRIME_ETH_USD_RATE"]) || 3000;
const priceUsd = Number(process.env["PRIME_RUN_PRICE_USD"]) || 20;
// Pay exactly one run's price in ETH at the configured rate (test-scale).
const valueWei = ethers.parseEther(String(priceUsd / rate));
const tx = await signer.sendTransaction({ to: await signer.getAddress(), value: valueWei });
await tx.wait();
console.log(`✓ paid ${ethers.formatEther(valueWei)} ETH on Base: ${tx.hash.slice(0, 18)}…`);

// 4: verify → credits
const credited = await verifyTopupInternal(identity, tx.hash);
if (!credited.ok) throw new Error(`topup rejected: ${credited.error}`);
console.log(`✓ topup verified: +${credited.creditsAdded} credits (balance ${credited.credits})`);

// 5: paid run consumes a credit
const paid = await consumeRun(identity, "INQ-paid-1");
if (!paid.ok || paid.source !== "credits")
  throw new Error(`paid run failed: ${JSON.stringify(paid)}`);
console.log(`✓ paid run consumed a credit (${paid.creditsLeft} left)`);

// 6: replay protection
const replay = await verifyTopupInternal(identity, tx.hash);
if (replay.ok) throw new Error("replay should have been rejected");
console.log(`✓ replay rejected: ${replay.error}`);

// cleanup the smoke account
const [row] = await db.select().from(accounts).where(eq(accounts.identity, identity));
if (row) await db.delete(accounts).where(eq(accounts.id, row.id));

console.log("\ncredits smoke done — all legs passed.");
process.exit(0);
