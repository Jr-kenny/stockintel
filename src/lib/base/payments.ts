/**
 * Prime Base Layer settlement model (USD, settled in USDC on Base).
 *
 * Flow:
 *   1. Customer prepays inquiry credits in USDC on Base.
 *   2. Each inquiry escrows: platform share + contributor pool share.
 *   3. After grading, contribution weights are committed onchain (anchor).
 *   4. The platform signer pushes each agent its settled share in USDC —
 *      one transfer per wallet, so one failed transfer never blocks a cycle.
 *
 * This module owns the numbers and the settlement record shape both sides
 * agree on; payouts.ts owns the transfers.
 */

export const INQUIRY_PRICING = {
  /** USD per standard inquiry readout. */
  standardInquiryUsd: Number(process.env["PRIME_RUN_PRICE_USD"]) || 20,
  /** Share of each inquiry payment that funds the contributor pool (60%). */
  contributorPoolShare: 0.6,
  /** Platform + infrastructure + processing take (40%). */
  platformShare: 0.4,
} as const;

/**
 * Split an actually-received payment into platform take and contributor pool.
 * `paidNative` is the native ETH amount the buyer sent; conversion uses the
 * same rate the paywall quoted, so the pool always reflects real money in.
 */
export function splitPayment(paidNative: number): {
  paidUsd: number;
  poolUsd: number;
  platformUsd: number;
} {
  const rate = Number(process.env["PRIME_ETH_USD_RATE"]) || 3000;
  const paidUsd = paidNative * rate;
  return {
    paidUsd: Math.round(paidUsd * 100) / 100,
    poolUsd: Math.round(paidUsd * INQUIRY_PRICING.contributorPoolShare * 100) / 100,
    platformUsd: Math.round(paidUsd * INQUIRY_PRICING.platformShare * 100) / 100,
  };
}

export type SettlementLine = {
  agentId: string;
  wallet: string;
  weight: number;
  /** weight / totalWeight, normalized to the pool. */
  shareOfPool: number;
  amountUsd: number;
};

export function buildSettlement(weights: { agentId: string; wallet: string; weight: number }[]): {
  poolUsd: number;
  lines: SettlementLine[];
} {
  const poolUsd = INQUIRY_PRICING.standardInquiryUsd * INQUIRY_PRICING.contributorPoolShare;
  const totalWeight = weights.reduce((sum, w) => sum + Math.max(w.weight, 0), 0);
  const lines = weights.map((w) => ({
    ...w,
    shareOfPool: totalWeight > 0 ? w.weight / totalWeight : 0,
    amountUsd: totalWeight > 0 ? Math.round(poolUsd * (w.weight / totalWeight) * 100) / 100 : 0,
  }));
  return { poolUsd, lines };
}
