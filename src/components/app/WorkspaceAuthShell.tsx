import { Suspense, lazy, useEffect, useState } from "react";
import { privyConfigured } from "./PrivyBridge";

const WorkspaceAuth = lazy(() =>
  import("./workspace-auth").then((m) => ({ default: m.WorkspaceAuth })),
);

function GuestBlock() {
  return (
    <div className="app-workspace-block">
      <p className="label-mono">Workspace</p>
      <p className="mt-1 text-sm text-ink">Your workspace</p>
      <p className="font-mono text-[0.62rem] leading-relaxed text-ink-muted">
        Sign-in is not configured on this deployment.
      </p>
    </div>
  );
}

/**
 * Client-only shell around the auth block. Keeps the Privy SDK out of SSR.
 */
export function WorkspaceAuthShell() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div className="app-workspace-block">
        <p className="label-mono">Workspace</p>
        <p className="mt-1 text-sm text-ink">Your workspace</p>
      </div>
    );
  }

  if (!privyConfigured()) return <GuestBlock />;

  return (
    <Suspense
      fallback={
        <div className="app-workspace-block">
          <p className="label-mono">Workspace</p>
          <p className="mt-1 text-sm text-ink-muted">Checking session…</p>
        </div>
      }
    >
      <WorkspaceAuth />
    </Suspense>
  );
}
