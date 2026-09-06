import { Lock } from "lucide-react";

/**
 * Overlay card shown instead of write actions while signed out.
 * Explains why sign-in is needed and opens the Privy login modal.
 */
export function RequireAuthFallback({
  signIn,
  prompting,
}: {
  signIn: () => void;
  prompting: boolean;
}) {
  return (
    <section className="surface-dark mb-8 flex flex-col items-start gap-4 p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <Lock className="size-4 text-signal" aria-hidden />
        <p className="label-mono text-signal">Workspace required</p>
      </div>
      <div>
        <h2 className="font-display text-xl text-vellum">Sign in to run this action</h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Intelligence runs and watchlist entries are tied to your workspace and stay
          private to your account. Sign in or create one to continue; email,
          social accounts or a passkey all work.
        </p>
      </div>
      <button type="button" onClick={signIn} className="app-signal-button" disabled={prompting}>
        {prompting ? "Opening sign-in…" : "Sign in / Sign up"}
      </button>
    </section>
  );
}
