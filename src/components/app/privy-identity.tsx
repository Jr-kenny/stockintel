import { Suspense, lazy, useEffect, useState } from "react";
import type { ConnectedWallet } from "@privy-io/react-auth";
import { privyConfigured } from "./PrivyBridge";

/**
 * Client-only reporter for the signed-in identity and connected wallets.
 * Mounted nowhere during SSR. The inner component (and its Privy hooks)
 * only exists in the browser, under the root PrivyBridge.
 */

export type PrivyIdentityInfo = {
  authenticated: boolean;
  email: string | null;
  /** Embedded/connected wallet address from the Privy user, if any. */
  walletAddress: string | null;
  /** First live wallet connection (can request signatures / send txs). */
  firstWallet: ConnectedWallet | null;
};

const Inner = lazy(() =>
  import("./privy-identity-inner").then((m) => ({ default: m.PrivyIdentityInner })),
);

export function PrivyIdentity({ onChange }: { onChange: (info: PrivyIdentityInfo) => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted || !privyConfigured()) return null;
  return (
    <Suspense fallback={null}>
      <Inner onChange={onChange} />
    </Suspense>
  );
}
