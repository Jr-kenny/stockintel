import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { db, ensureSchema, nowIso, newId } from "@/lib/db";
import { accounts, creditLedger } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { baseConfig } from "@/lib/base/config";

/**
 * Accounts & credits — the meter for the intelligence layer.
 *
 * Every signed-in business gets a workspace account keyed by its Privy
 * identity (email or embedded-wallet address). New accounts start with
 * FREE_TRIAL_RUNS free runs; after that each run consumes one credit.
 * Credits are topped up by paying the platform wallet on Base — the
 * client sends the tx, the server verifies it on-chain before crediting.
 * Guest mode (no Privy configured) is unmetered so dev keeps working.
 */

export const FREE_TRIAL_RUNS = 5;
/** USD per intelligence run (PRIME_RUN_PRICE_USD, default 20). */
export const RUN_PRICE_USD = (() => {
  const v = Number(process.env["PRIME_RUN_PRICE_USD"]);
  return Number.isFinite(v) && v > 0 ? v : 20;
})();
/** Platform wallet that receives top-up payments (Base chain). */
export function platformWallet(): string {
  return (
    process.env["PRIME_PLATFORM_WALLET"]?.trim() ||
    process.env["PRIME_ORCHESTRATOR_WALLET"]?.trim() ||
    ""
  );
}

export function pricingPublic() {
  return {
    freeRuns: FREE_TRIAL_RUNS,
    priceUsd: RUN_PRICE_USD,
    ...(platformWallet() ? { paymentWallet: platformWallet() } : {}),
  };
}

const identitySchema = z.object({
  identity: z.string().min(3).max(120), // email or wallet address
  email: z.string().max(160).optional(),
  wallet: z.string().max(60).optional(),
});

export type AccountView = {
  id: string;
  credits: number;
  freeRunsUsed: number;
  freeRunsLeft: number;
  priceUsd: number;
};

/** Fetch-or-create the caller's account row (plain helper for server use). */
export async function getOrCreateAccount(
  identity: string,
  email?: string,
  wallet?: string,
): Promise<AccountView> {
  await ensureSchema();
  let [row] = await db.select().from(accounts).where(eq(accounts.identity, identity));
  if (!row) {
    const id = newId("ACC");
    await db.insert(accounts).values({
      id,
      identity,
      ...(email ? { email } : {}),
      ...(wallet ? { wallet } : {}),
      credits: 0,
      freeRunsUsed: 0,
      createdAt: nowIso(),
    });
    [row] = await db.select().from(accounts).where(eq(accounts.identity, identity));
  }
  const freeLeft = Math.max(0, FREE_TRIAL_RUNS - (row?.freeRunsUsed ?? 0));
  return {
    id: row!.id,
    credits: row!.credits,
    freeRunsUsed: row!.freeRunsUsed,
    freeRunsLeft: freeLeft,
    priceUsd: RUN_PRICE_USD,
  };
}

/** Fetch (or lazily create) the caller's account + current balance. */
export const getAccount = createServerFn({ method: "POST" })
  .validator((input: unknown) => identitySchema.parse(input))
  .handler(async ({ data }) => getOrCreateAccount(data.identity, data.email, data.wallet));

const consumeSchema = z.object({
  identity: z.string().min(3).max(120),
  inquiryId: z.string().min(3).max(60),
});

export type ConsumeResult =
  | { ok: true; source: "free"; freeRunsLeft: number; credits: number }
  | { ok: true; source: "credits"; creditsLeft: number }
  | {
      ok: false;
      reason: "out_of_credits";
      freeRunsLeft: 0;
      priceUsd: number;
      paymentWallet?: string;
    };

/**
 * Atomically spend one run: a free trial first, then a paid credit.
 * Called by submitInquiry before dispatch.
 */
export async function consumeRun(identity: string, inquiryId: string): Promise<ConsumeResult> {
  await ensureSchema();
  let [account] = await db.select().from(accounts).where(eq(accounts.identity, identity));
  if (!account) {
    const id = newId("ACC");
    await db.insert(accounts).values({
      id,
      identity,
      credits: 0,
      freeRunsUsed: 0,
      createdAt: nowIso(),
    });
    [account] = await db.select().from(accounts).where(eq(accounts.identity, identity));
  }
  const a = account!;

  if (a.freeRunsUsed < FREE_TRIAL_RUNS) {
    await db
      .update(accounts)
      .set({ freeRunsUsed: a.freeRunsUsed + 1, updatedAt: nowIso() })
      .where(eq(accounts.id, a.id));
    await db.insert(creditLedger).values({
      accountId: a.id,
      delta: 0,
      kind: "free_run",
      inquiryId,
      createdAt: nowIso(),
    });
    return {
      ok: true,
      source: "free",
      freeRunsLeft: FREE_TRIAL_RUNS - a.freeRunsUsed - 1,
      credits: a.credits,
    };
  }

  if (a.credits >= 1) {
    await db
      .update(accounts)
      .set({ credits: a.credits - 1, updatedAt: nowIso() })
      .where(eq(accounts.id, a.id));
    await db.insert(creditLedger).values({
      accountId: a.id,
      delta: -1,
      kind: "run",
      inquiryId,
      createdAt: nowIso(),
    });
    return { ok: true, source: "credits", creditsLeft: a.credits - 1 };
  }

  return {
    ok: false,
    reason: "out_of_credits",
    freeRunsLeft: 0,
    priceUsd: RUN_PRICE_USD,
    ...(platformWallet() ? { paymentWallet: platformWallet() } : {}),
  };
}

const topupSchema = z.object({
  identity: z.string().min(3).max(120),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, "not a tx hash"),
});

export type TopupResult =
  | { ok: true; creditsAdded: number; credits: number; txHash: string; amountEth: number }
  | { ok: false; error: string };

/** Core topup verification — plain function so scripts can exercise it. */
export async function verifyTopupInternal(identity: string, txHash: string): Promise<TopupResult> {
  await ensureSchema();
  const receiver = platformWallet();
  if (!receiver) return { ok: false, error: "Payments are not configured yet." };

  // Replay guard: the same tx can never fund two accounts.
  const seen = await db.select().from(creditLedger).where(eq(creditLedger.txHash, txHash));
  if (seen.length > 0) return { ok: false, error: "This payment was already credited." };

  const { ethers } = await import("ethers");
  const rpc = baseConfig().rpcUrl;
  const provider = new ethers.JsonRpcProvider(rpc);
  let tx;
  let receipt;
  try {
    tx = await provider.getTransaction(txHash);
    if (!tx)
      return { ok: false, error: "Transaction not found yet — wait a few seconds and retry." };
    receipt = await provider.waitForTransaction(txHash, 1, 30_000);
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Chain read failed: ${err.message.slice(0, 120)}`
          : "Chain read failed",
    };
  }
  if (!receipt || receipt.status !== 1) return { ok: false, error: "Transaction failed on chain." };
  if ((tx.to ?? "").toLowerCase() !== receiver.toLowerCase()) {
    return { ok: false, error: "Payment did not go to the platform wallet." };
  }
  if (tx.value <= 0n) return { ok: false, error: "Nothing was paid." };

  // Pricing: RUN_PRICE_USD per run, live ETH price (60s cache).
  const rate = await ethUsdRate();
  const amountUsd = (Number(ethers.formatEther(tx.value)) * rate) | 0;
  const creditsAdded = Math.floor(amountUsd / RUN_PRICE_USD);
  if (creditsAdded < 1) {
    return {
      ok: false,
      error: `Payment too small — one run is $${RUN_PRICE_USD} (~${(RUN_PRICE_USD / rate).toFixed(6)} ETH at $${rate.toFixed(2)}/ETH live). Sent ${ethers.formatEther(tx.value)} ETH.`,
    };
  }

  let [account] = await db.select().from(accounts).where(eq(accounts.identity, identity));
  if (!account) {
    const id = newId("ACC");
    await db.insert(accounts).values({
      id,
      identity: identity,
      credits: 0,
      freeRunsUsed: 0,
      createdAt: nowIso(),
    });
    [account] = await db.select().from(accounts).where(eq(accounts.identity, identity));
  }

  await db
    .update(accounts)
    .set({ credits: account!.credits + creditsAdded, updatedAt: nowIso() })
    .where(eq(accounts.id, account!.id));
  await db.insert(creditLedger).values({
    accountId: account!.id,
    delta: creditsAdded,
    kind: "topup",
    txHash: txHash,
    createdAt: nowIso(),
  });

  return {
    ok: true,
    creditsAdded,
    credits: account!.credits + creditsAdded,
    txHash: txHash,
    amountEth: Number(ethers.formatEther(tx.value)),
  };
}

/** Server-fn wrapper around verifyTopupInternal. */
export const verifyTopup = createServerFn({ method: "POST" })
  .validator((input: unknown) => topupSchema.parse(input))
  .handler(async ({ data }) => verifyTopupInternal(data.identity, data.txHash));

/**
 * Pay-per-run flow: the buyer pays FROM THEIR OWN PRIVY WALLET straight to
 * the platform wallet — one payment, one run, no balance, no manual
 * hash-pasting. The server quotes the exact wei and verifies the resulting
 * tx on-chain before the run dispatches.
 */

/** Live ETH/USD with 60s cache — falls back to PRIME_ETH_USD_RATE or 3000. */
let cachedRate: { value: number; at: number } | null = null;
export async function ethUsdRate(): Promise<number> {
  const fallback = Number(process.env["PRIME_ETH_USD_RATE"]) || 3000;
  if (cachedRate && Date.now() - cachedRate.at < 60_000) return cachedRate.value;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 4000);
    // Coinbase spot is CORS-free server-side and no key. CoinGecko is backup.
    const res = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot", { signal: controller.signal });
    clearTimeout(t);
    const j = (await res.json()) as { data?: { amount?: string } };
    const v = Number(j?.data?.amount);
    if (Number.isFinite(v) && v > 100 && v < 100_000) {
      cachedRate = { value: v, at: Date.now() };
      return v;
    }
  } catch {}
  try {
    const r2 = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd");
    const j2 = (await r2.json()) as { ethereum?: { usd?: number } };
    const v2 = Number(j2?.ethereum?.usd);
    if (Number.isFinite(v2) && v2 > 100) {
      cachedRate = { value: v2, at: Date.now() };
      return v2;
    }
  } catch {}
  return fallback;
}

/** Exact native-wei price of one intelligence run at the live rate. */
export async function runPriceInvoice() {
  const receiver = platformWallet();
  const { ethers } = await import("ethers");
  const rate = await ethUsdRate();
  return {
    ...(receiver ? { wallet: receiver } : {}),
    usd: RUN_PRICE_USD,
    rate,
    rateSource: cachedRate ? "live" : "fallback",
    amountWei: ethers.parseEther((RUN_PRICE_USD / rate).toFixed(12)).toString(),
    amountEth: (RUN_PRICE_USD / rate).toFixed(6),
  };
}

export type RunPaymentResult = { ok: true; paidNative: number } | { ok: false; error: string };

/**
 * Verifies a per-run payment tx: confirmed, paid the platform wallet in
 * native 0G, worth at least one run, and never used for another run.
 * Marks the tx consumed so it can't fund two runs.
 */
export async function verifyRunPayment(
  txHash: string,
  inquiryId: string,
  accountId: string,
): Promise<RunPaymentResult> {
  await ensureSchema();
  const receiver = platformWallet();
  if (!receiver) return { ok: false, error: "Payments are not configured yet." };

  const invoice = await runPriceInvoice();
  const minWei = BigInt(invoice.amountWei);

  // Replay guard across ALL run payments and topups.
  const seen = await db.select().from(creditLedger).where(eq(creditLedger.txHash, txHash));
  if (seen.length > 0) return { ok: false, error: "This payment was already used." };

  const { ethers } = await import("ethers");
  const provider = new ethers.JsonRpcProvider(baseConfig().rpcUrl);
  let tx;
  let receipt;
  try {
    tx = await provider.getTransaction(txHash);
    if (!tx) return { ok: false, error: "Payment not visible on-chain yet — retry in a moment." };
    receipt = await provider.waitForTransaction(txHash, 1, 45_000);
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Chain read failed: ${err.message.slice(0, 120)}`
          : "Chain read failed",
    };
  }
  if (!receipt || receipt.status !== 1) return { ok: false, error: "Payment failed on chain." };
  if ((tx.to ?? "").toLowerCase() !== receiver.toLowerCase()) {
    return { ok: false, error: "Payment did not reach the platform wallet." };
  }
  if (tx.value < minWei) {
    const rate = await ethUsdRate();
    return {
      ok: false,
      error: `Underpaid — one run costs $${RUN_PRICE_USD} (${ethers.formatEther(minWei)} ETH at $${rate.toFixed(2)}/ETH live).`,
    };
  }

  await db.insert(creditLedger).values({
    accountId,
    delta: 0,
    kind: "run_payment",
    txHash,
    inquiryId,
    paidNative: Number(ethers.formatEther(tx.value)),
    createdAt: nowIso(),
  });
  return { ok: true, paidNative: Number(ethers.formatEther(tx.value)) };
}
