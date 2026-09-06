import { useCallback, useEffect, useState } from "react";
import { StatusPill } from "@/components/app/AppUI";
import { beginAgentOsConnect, disconnectAgentOs, getAgentOsStatus } from "@/lib/binance/fns";

type Probe =
  | { live: true; tools: string[]; detail: string }
  | { live: false; reason: "no-token" | "firewall" | "auth" | "error"; detail: string };

type Status = { connected: boolean; scope?: string; probe: Probe } | null;

/**
 * Agent OS connection control for the market check header.
 * Read-only scopes only. Signed-out visitors see the mirror badge
 * with a sign-in hint. Nothing here ever requests trade scopes.
 */
export function AgentOsConnect({ identity }: { identity: string | null }) {
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void getAgentOsStatus({ data: { ...(identity ? { identity } : {}) } })
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [identity]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // OAuth redirect lands back on /app?binance=connected|error. Surface it
  // once, clean the URL, and refresh the badge.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("binance");
    if (!result) return;
    if (result === "connected") {
      setNotice("Agent OS connected. Market context now flows through your session.");
    } else {
      setNotice(params.get("reason") || "Agent OS connect did not finish. Try again.");
    }
    params.delete("binance");
    params.delete("reason");
    const rest = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`);
    refresh();
  }, [refresh]);

  const connect = useCallback(() => {
    if (!identity || busy) return;
    setBusy(true);
    setNotice(null);
    void beginAgentOsConnect({ data: { identity } })
      .then(({ url }) => {
        window.location.href = url;
      })
      .catch((err: unknown) => {
        setNotice(err instanceof Error ? err.message : "Connect failed. Try again.");
        setBusy(false);
      });
  }, [identity, busy]);

  const disconnect = useCallback(() => {
    if (!identity || busy) return;
    setBusy(true);
    void disconnectAgentOs({ data: { identity } })
      .then(() => {
        setNotice("Agent OS disconnected. Public mirror continues.");
        setBusy(false);
        refresh();
      })
      .catch(() => setBusy(false));
  }, [identity, busy, refresh]);

  const live = status?.probe.live === true;
  const connected = status?.connected === true;

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Agent OS connection">
      {live ? (
        <StatusPill tone="verified" label="Live via Agent OS" />
      ) : connected ? (
        <StatusPill tone="tracking" label="Agent OS warming up" />
      ) : (
        <StatusPill tone="tracking" label="Live via public mirror" />
      )}
      {identity ? (
        connected ? (
          <button
            type="button"
            onClick={disconnect}
            disabled={busy}
            className="font-mono text-[11px] text-muted-foreground underline underline-offset-2 hover:text-ink disabled:opacity-60"
          >
            {busy ? "Working" : "Disconnect Agent OS"}
          </button>
        ) : (
          <button
            type="button"
            onClick={connect}
            disabled={busy}
            className="font-mono text-[11px] text-signal underline underline-offset-2 hover:opacity-80 disabled:opacity-60"
          >
            {busy ? "Redirecting" : "Connect Agent OS"}
          </button>
        )
      ) : (
        <span className="font-mono text-[11px] text-muted-foreground">
          Sign in to connect Agent OS
        </span>
      )}
      {notice && (
        <span
          className="w-full font-mono text-[11px] leading-relaxed text-muted-foreground"
          role="status"
        >
          {notice}
        </span>
      )}
      {status && !live && status.probe.live === false && status.probe.reason === "firewall" && (
        <span className="w-full font-mono text-[11px] leading-relaxed text-muted-foreground">
          Edge firewall challenged the server call. Prices continue through the public mirror.
        </span>
      )}
    </div>
  );
}
