import { useEffect, useMemo } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import type { PrivyIdentityInfo } from "./privy-identity";

/** Browser-only. Lives under the root PrivyBridge. Hooks are safe here. */
export function PrivyIdentityInner({ onChange }: { onChange: (info: PrivyIdentityInfo) => void }) {
  const { authenticated, user } = usePrivy();
  const { wallets } = useWallets();

  const info = useMemo<PrivyIdentityInfo>(
    () => ({
      authenticated,
      email: user?.email?.address ?? null,
      walletAddress: user?.wallet?.address ?? null,
      firstWallet: wallets[0] ?? null,
    }),
    [authenticated, user?.email?.address, user?.wallet?.address, wallets],
  );

  useEffect(() => {
    onChange(info);
  }, [info, onChange]);

  return null;
}
