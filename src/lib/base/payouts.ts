import { baseConfig } from "./config";
import { isPlaceholderWallet } from "./wallets";

/**
 * Base settlement — turns graded settlement lines into real on-chain
 * payouts in USDC on Base. Prizes and contributor rewards are USDC-denominated,
 * so amounts map 1:1 to the USD weights the grader produces — no conversion
 * step, no token price exposure.
 *
 * Flow per cycle:
 *   1. Lines arrive weight-sized (USD).
 *   2. Aggregated per wallet — one transfer per agent per cycle.
 *   3. Platform signer (BASE_SIGNER_KEY) sends USDC directly to each agent.
 *
 * Guards (all env-tunable):
 *   - PRIME_PAYOUT_BUDGET_USD  per-cycle payout budget (default 25 USDC)
 *   - PRIME_MIN_PAYOUT_USD     skip wallets smaller than this (dust guard,
 *                              default 0.01 USDC) — unpaid rows stay pending
 *                              and scripts/retry-payouts.ts sweeps later
 *   - PRIME_GAS_RESERVE_ETH    never spend the signer's ETH below this
 *   - BASE_PAY_DISABLED=true   kill-switch, rows stay pending
 *
 * Placeholder wallets (sample agents) and the platform's own address never
 * receive anything. A failed transfer marks its rows with an error and keeps
 * going — one bad wallet can never stall a cycle's payroll.
 */

/** Official USDC (Base mainnet and Base Sepolia share the same address). */
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const USDC_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

type UsdcContract = {
  transfer(
    to: string,
    amount: bigint,
  ): Promise<{ hash: string; wait(): Promise<{ hash: string }> }>;
  balanceOf(owner: string): Promise<bigint>;
  decimals(): Promise<number>;
};

export type PayoutConfig = {
  live: boolean;
  budgetUsd: number;
  minPayoutUsd: number;
  gasReserveEth: number;
};

export function payoutConfig(): PayoutConfig {
  const num = (name: string, fallback: number) => {
    const v = Number(process.env[name]);
    return Number.isFinite(v) && v >= 0 ? v : fallback;
  };
  const disabled = process.env["BASE_PAY_DISABLED"] === "true";
  const { privateKey } = baseConfig();
  return {
    live: Boolean(privateKey) && !disabled,
    budgetUsd: num("PRIME_PAYOUT_BUDGET_USD", 25),
    minPayoutUsd: num("PRIME_MIN_PAYOUT_USD", 0.01),
    gasReserveEth: num("PRIME_GAS_RESERVE_ETH", 0.0002),
  };
}

export type PayableLine = {
  /** settlements.id — the row(s) to stamp with tx / error. */
  rowId: number;
  agentId: string;
  wallet: string;
  /** USD weight (1 unit = 1 USDC). */
  weight: number;
};

export type WalletAttempt = {
  wallet: string;
  amountUsd: string;
  /** Every settlement row this aggregated payout covers. */
  rowIds: number[];
  txHash?: string;
  error?: string;
};

export type SettleResult = {
  attempted: WalletAttempt[];
  skipped: { wallet: string; reason: string }[];
  totalPaidUsd: number;
};

/** One signer = one nonce stream; serialise payroll exactly like anchors/mints. */
let payQueue: Promise<unknown> = Promise.resolve();
function enqueuePay<T>(task: () => Promise<T>): Promise<T> {
  const run = payQueue.then(task, task);
  payQueue = run.catch(() => undefined);
  return run;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Pays one cycle's lines, weight-proportional out of the USDC budget, one
 * transfer per wallet. Row stamping is the caller's job via returned rowIds.
 */
export async function settleCycle(
  lines: PayableLine[],
  opts?: { budgetUsdOverride?: number },
): Promise<SettleResult> {
  const config = payoutConfig();
  const result: SettleResult = { attempted: [], skipped: [], totalPaidUsd: 0 };
  if (!config.live || lines.length === 0) {
    for (const l of lines) result.skipped.push({ wallet: l.wallet, reason: "payouts not live" });
    return result;
  }

  return enqueuePay(async () => {
    const { ethers } = await import("ethers");
    const { privateKey, rpcUrl } = baseConfig();
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const signer = new ethers.Wallet(privateKey!, provider);
    const selfAddress = (await signer.getAddress()).toLowerCase();
    const usdc = new ethers.Contract(USDC_BASE, USDC_ABI, signer) as unknown as UsdcContract;

    // Aggregate lines per wallet — one payout per agent per cycle.
    const byWallet = new Map<string, { rowIds: number[]; weight: number }>();
    for (const l of lines) {
      if (isPlaceholderWallet(l.wallet)) {
        result.skipped.push({ wallet: l.wallet, reason: "placeholder wallet" });
        continue;
      }
      if (l.wallet.toLowerCase() === selfAddress) {
        result.skipped.push({ wallet: l.wallet, reason: "platform's own signer" });
        continue;
      }
      const entry = byWallet.get(l.wallet) ?? { rowIds: [], weight: 0 };
      entry.rowIds.push(l.rowId);
      entry.weight += Math.max(l.weight, 0);
      byWallet.set(l.wallet, entry);
    }

    const totalWeight = Array.from(byWallet.values()).reduce((s, e) => s + e.weight, 0);
    if (totalWeight <= 0) {
      for (const [wallet] of byWallet) result.skipped.push({ wallet, reason: "zero weight" });
      return result;
    }

    const budget = opts?.budgetUsdOverride ?? config.budgetUsd;
    const SCALE = 1_000_000;
    const sized = Array.from(byWallet.entries()).map(([wallet, entry]) => ({
      wallet,
      rowIds: entry.rowIds,
      amountUsd: round2((budget * entry.weight) / totalWeight),
    }));

    // Gas guard: keep enough native ETH for future anchors/payouts.
    const ethBalance = Number(
      ethers.formatEther(await provider.getBalance(await signer.getAddress())),
    );
    if (ethBalance <= config.gasReserveEth) {
      for (const l of sized)
        result.skipped.push({
          wallet: l.wallet,
          reason: `signer ETH too low for gas (${ethBalance.toFixed(6)} ETH)`,
        });
      return result;
    }

    // USDC balance caps what we can actually pay out.
    const usdcRaw = (await usdc.balanceOf(await signer.getAddress())) as bigint;
    const usdcDecimals = (await usdc.decimals()) as number;
    const usdcBalance = Number(ethers.formatUnits(usdcRaw, usdcDecimals));
    const spendable = Math.min(
      sized.reduce((s, l) => s + l.amountUsd, 0),
      usdcBalance,
    );
    if (spendable <= 0) {
      for (const l of sized)
        result.skipped.push({
          wallet: l.wallet,
          reason: `signer USDC balance is ${usdcBalance.toFixed(2)} USDC`,
        });
      return result;
    }
    const plannedTotal = sized.reduce((s, l) => s + l.amountUsd, 0);
    if (spendable < plannedTotal) {
      // Scale every wallet's share down proportionally to what we can afford.
      for (const l of sized) l.amountUsd = round2(l.amountUsd * (spendable / plannedTotal));
    }

    for (const l of sized) {
      if (l.amountUsd < config.minPayoutUsd) {
        result.skipped.push({
          wallet: l.wallet,
          reason: `share $${l.amountUsd.toFixed(2)} below dust minimum $${config.minPayoutUsd}`,
        });
        continue;
      }
      try {
        const amountRaw = ethers.parseUnits(l.amountUsd.toFixed(2), usdcDecimals);
        const tx = await usdc.transfer(l.wallet, amountRaw);
        await tx.wait();
        result.attempted.push({
          wallet: l.wallet,
          amountUsd: l.amountUsd.toFixed(2),
          rowIds: l.rowIds,
          txHash: tx.hash,
        });
        result.totalPaidUsd += l.amountUsd;
      } catch (err) {
        result.attempted.push({
          wallet: l.wallet,
          amountUsd: l.amountUsd.toFixed(2),
          rowIds: l.rowIds,
          error: err instanceof Error ? err.message.slice(0, 200) : "transfer failed",
        });
      }
    }
    return result;
  });
}
