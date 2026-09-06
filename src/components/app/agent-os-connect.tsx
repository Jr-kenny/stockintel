import { useEffect, useState } from "react";
import { StatusPill } from "@/components/app/AppUI";
import { getAgentOsStatus } from "@/lib/binance/fns";

type Probe =
  | { live: true; tools: string[]; detail: string }
  | { live: false; reason: "no-token" | "firewall" | "auth" | "error"; detail: string };

/** Source badge for the market check header. Reports only, no buttons. */
export function AgentOsConnect({ identity }: { identity: string | null }) {
  void identity;
  const [probe, setProbe] = useState<Probe | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getAgentOsStatus({})
      .then((s) => {
        if (!cancelled) setProbe(s.probe);
      })
      .catch(() => {
        if (!cancelled) setProbe(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const live = probe?.live === true;
  const warming = probe?.live === false && probe.reason === "auth";

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Agent OS connection">
      {live ? (
        <StatusPill tone="verified" label="Live via Agent OS" />
      ) : warming ? (
        <StatusPill tone="tracking" label="Agent OS warming up" />
      ) : (
        <StatusPill tone="tracking" label="Live via public mirror" />
      )}
      {probe && !live && probe.live === false && probe.reason === "firewall" && (
        <span className="w-full font-mono text-[11px] leading-relaxed text-muted-foreground">
          Edge firewall challenged the server call. Prices continue through the public mirror.
        </span>
      )}
    </div>
  );
}
