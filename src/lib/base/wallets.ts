/**
 * Shared wallet helpers.
 *
 * Placeholder wallets are the sample/demo agents seeded with tiny numeric
 * addresses ("123", "456"...) — they must never receive real money.
 */
const PLACEHOLDER_LIMIT = 1000n;

export function isPlaceholderWallet(wallet: string): boolean {
  try {
    return BigInt(wallet) < PLACEHOLDER_LIMIT;
  } catch {
    return true;
  }
}
