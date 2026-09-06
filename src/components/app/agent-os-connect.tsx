import { useCallback, useEffect, useState } from "react";
import { StatusPill } from "@/components/app/AppUI";
import { disconnectAgentOs, getAgentOsStatus } from "@/lib/binance/fns";

type Probe =
  | { live: true; tools: string[]; detail: string }
  | { live: false; reason: "no-token" | "firewall" | "auth" | "error"; detail: string };

type Status = { connected: boolean; scope?: string; probe: Probe } | null;

/**
 * Source badge for the market check header. Connect lives in the login
 * prompt and the workspace menu. This only reports and disconnects.
 */
export function AgentOsConnect({ identity }: { identity: string | null }) {
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getAgentOsStatus({ data: { ...(identity ? { identity } : {}) } })
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [identity]);

  const disconnect = useCallback(() => {
    if (!identity || busy) return;
    setBusy(true);
    void disconnectAgentOs({ data: { identity } })
      .then(() => setStatus((s) => (s ? { ...s, connected: false } : s)))
      .finally(() => setBusy(false));
  }, [identity, busy]);

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
      {connected && identity && (
        <button
          type="button"
          onClick={disconnect}
          disabled={busy}
          className="font-mono text-[11px] text-muted-foreground underline underline-offset-2 hover:text-ink disabled:opacity-60"
        >
          {busy ? "Working" : "Disconnect"}
        </button>
      )}
      {status && !live && status.probe.live === false && status.probe.reason === "firewall" && (
        <span className="w-full font-mono text-[11px] leading-relaxed text-muted-foreground">
          Edge firewall challenged the server call. Prices continue through the public mirror.
        </span>
      )}
    </div>
  );
}
