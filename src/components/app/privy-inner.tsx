import { PrivyProvider } from "@privy-io/react-auth";
import type { ReactNode } from "react";

/**
 * Client-only module. Loaded through a lazy boundary so the Privy SDK is
 * never evaluated during SSR.
 *
 * Each listed method must also be enabled in the Privy dashboard for the
 * app; listing it here alone makes the button appear but the flow 404s.
 */
export function PrivyInner({ children, appId }: { children: ReactNode; appId: string }) {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email", "google", "github", "discord", "twitter", "farcaster", "passkey"],
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
