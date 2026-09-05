import { usePrivy } from "@privy-io/react-auth";
import type { LoginModalOptions } from "@privy-io/react-auth";
import { useState, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { RequireAuthFallback } from "./auth-gate-fallback";

/**
 * Client-only counterparts to the gates in auth-gate.tsx. Mounted under the
 * root PrivyBridge, so usePrivy is safe here.
 */

/** Signed out: the wrapped write UI is replaced by the sign-in prompt card. */
export function AuthGateInner({ children }: { children: ReactNode }) {
  const { ready, authenticated, login } = usePrivy();
  const [prompting, setPrompting] = useState(false);

  if (!ready) return <>{children}</>;
  if (authenticated) return <>{children}</>;

  const signIn = () => openLogin(login, setPrompting);

  return <RequireAuthFallback signIn={signIn} prompting={prompting} />;
}

/** Signed out: the real control is swapped for a look-alike sign-in button. */
export function AuthActionInner({
  children,
  signInLabel,
  className,
}: {
  children: ReactNode;
  signInLabel?: string | undefined;
  className?: string | undefined;
}) {
  const { ready, authenticated, login } = usePrivy();
  const [prompting, setPrompting] = useState(false);

  if (!ready || authenticated) return <>{children}</>;

  return (
    <button
      type="button"
      className={className ?? "app-dark-button shrink-0"}
      disabled={prompting}
      onClick={() => openLogin(login, setPrompting)}
    >
      <Lock className="size-4" aria-hidden />
      {prompting ? "Opening sign-in…" : (signInLabel ?? "Sign in")}
    </button>
  );
}

function openLogin(
  login: (options?: LoginModalOptions) => void,
  setPrompting: (value: boolean) => void,
) {
  setPrompting(true);
  try {
    login();
  } finally {
    // The modal owns the flow from here; clear so a closed modal doesn't
    // leave a stuck label.
    window.setTimeout(() => setPrompting(false), 1500);
  }
}
