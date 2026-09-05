import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";

const PrivyInner = lazy(() => import("./privy-inner").then((m) => ({ default: m.PrivyInner })));

/**
 * Mounts the Privy provider in the browser only. When VITE_PRIVY_APP_ID is
 * not configured, children render without auth (guest mode).
 */
export function PrivyBridge({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return <>{children}</>;

  const env = import.meta.env as Record<string, string | undefined>;
  const appId = env["VITE_PRIVY_APP_ID"];
  if (!appId) return <>{children}</>;

  return (
    <Suspense fallback={null}>
      <PrivyInner appId={appId}>{children}</PrivyInner>
    </Suspense>
  );
}

export function privyConfigured() {
  const env = import.meta.env as Record<string, string | undefined>;
  return Boolean(env["VITE_PRIVY_APP_ID"]);
}
