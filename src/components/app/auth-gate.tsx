import { usePrivy } from "@privy-io/react-auth";
import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { privyConfigured } from "./PrivyBridge";

const AuthGateInner = lazy(() =>
  import("./auth-gate-inner").then((m) => ({ default: m.AuthGateInner })),
);
const AuthActionInner = lazy(() =>
  import("./auth-gate-inner").then((m) => ({ default: m.AuthActionInner })),
);

/**
 * Renders children only for signed-in users when Privy is configured.
 * Before hydration, and on deployments without VITE_PRIVY_APP_ID (guest
 * mode), children render as-is so SSR markup and demo mode keep working.
 *
 * Signed out, the wrapped write UI is replaced by a sign-in prompt card.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted || !privyConfigured()) return <>{children}</>;

  return (
    <Suspense fallback={<>{children}</>}>
      <AuthGateInner>{children}</AuthGateInner>
    </Suspense>
  );
}

/**
 * Same gate for single controls: signed out, the wrapped control is swapped
 * for a look-alike button that opens sign-in. Keeps toolbars' shape stable.
 */
export function RequireAuthAction({
  children,
  signInLabel,
  className,
}: {
  children: ReactNode;
  signInLabel?: string;
  className?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted || !privyConfigured()) return <>{children}</>;

  return (
    <Suspense fallback={<>{children}</>}>
      <AuthActionInner signInLabel={signInLabel ?? undefined} className={className ?? undefined}>
        {children}
      </AuthActionInner>
    </Suspense>
  );
}
