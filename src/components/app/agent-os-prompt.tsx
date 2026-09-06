import { useCallback, useEffect, useState } from "react";
import { PrivyIdentity, type PrivyIdentityInfo } from "@/components/app/privy-identity";
import {
  beginAgentOsConnect,
  getAgentOsHoldings,
  getAgentOsStatus,
  importAgentOsHoldings,
  type HoldingView,
} from "@/lib/binance/fns";

type Step = "hidden" | "explain" | "picker";

const dismissKey = (identity: string) => `agentos-prompt-dismissed:${identity}`;

/**
 * Post-login Agent OS prompt, mounted once in the workspace layout.
 *
 * Explain step: what connecting does, Authorize or Cancel. Cancelling
 * dismisses quietly and the run continues unconnected.
 * Picker step: after the authorize redirect returns, detected holdings
 * show with every box ticked. Untick to reject, import what stays ticked.
 */
export function AgentOsPrompt() {
  const [privy, setPrivy] = useState<PrivyIdentityInfo>({
    authenticated: false,
    email: null,
    walletAddress: null,
    firstWallet: null,
  });
  const identity = privy.email ?? privy.walletAddress ?? null;
  const [step, setStep] = useState<Step>("hidden");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [holdings, setHoldings] = useState<HoldingView[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const cleanUrl = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.get("binance")) return null;
    const result = params.get("binance");
    const reason = params.get("reason");
    params.delete("binance");
    params.delete("reason");
    const rest = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`);
    return { result, reason };
  }, []);

  // Initial state: connected workspaces stay quiet, dismissed ones too.
  useEffect(() => {
    if (!identity) {
      setStep("hidden");
      return;
    }
    let cancelled = false;
    void getAgentOsStatus({ data: { identity } })
      .then((s) => {
        if (cancelled) return;
        if (s.connected) {
          setStep("hidden");
          return;
        }
        let dismissed = false;
        try {
          dismissed = window.localStorage.getItem(dismissKey(identity)) === "1";
        } catch {
          dismissed = false;
        }
        setStep(dismissed ? "hidden" : "explain");
      })
      .catch(() => {
        if (!cancelled) setStep("hidden");
      });
    return () => {
      cancelled = true;
    };
  }, [identity]);

  // Authorize redirect lands back with ?binance=connected|error.
  useEffect(() => {
    if (!identity) return;
    const outcome = cleanUrl();
    if (!outcome) return;
    if (outcome.result === "connected") {
      setBusy(true);
      void getAgentOsHoldings({ data: { identity } })
        .then(({ holdings: found }) => {
          setHoldings(found);
          setChecked(new Set(found.map((h) => h.ticker)));
          setStep(found.length > 0 ? "picker" : "hidden");
          if (found.length === 0) setNotice("Connected. No holdings detected to import.");
        })
        .catch(() => setStep("hidden"))
        .finally(() => setBusy(false));
    } else {
      setNotice(
        outcome.reason || "Agent OS connect did not finish. Try again from the workspace menu.",
      );
      setStep("explain");
    }
  }, [identity, cleanUrl]);

  const authorize = useCallback(() => {
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

  const cancel = useCallback(() => {
    if (identity) {
      try {
        window.localStorage.setItem(dismissKey(identity), "1");
      } catch {
        // private browsing: dismissal lasts the session
      }
    }
    setStep("hidden");
  }, [identity]);

  const toggle = useCallback((ticker: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker);
      else next.add(ticker);
      return next;
    });
  }, []);

  const importSelected = useCallback(() => {
    if (!identity || busy) return;
    const tickers = [...checked];
    if (tickers.length === 0) {
      setStep("hidden");
      return;
    }
    setBusy(true);
    void importAgentOsHoldings({ data: { identity, tickers } })
      .then(({ added }) => {
        setNotice(
          added.length > 0
            ? `Watching ${added.join(", ")} from your Agentic sub-account.`
            : "Those are already on your watchlist.",
        );
        setStep("hidden");
        setBusy(false);
      })
      .catch(() => setBusy(false));
  }, [identity, busy, checked]);

  return (
    <>
      <PrivyIdentity onChange={setPrivy} />
      {notice && step === "hidden" && (
        <p className="px-4 pt-3 font-mono text-[11px] text-muted-foreground" role="status">
          {notice}
        </p>
      )}
      {step !== "hidden" && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Connect Agentic OS"
        >
          <div className="surface-dark w-full max-w-md p-6">
            {step === "explain" && (
              <>
                <p className="label-mono text-signal">Connect Agentic OS</p>
                <h2 className="mt-2 font-display text-xl leading-tight">
                  Let research speak to your holdings
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  Link your Binance Agentic sub-account and StockIntel reads your balances into the
                  watchlist, then ranks every event against what you actually hold. Read-only market
                  data and read-only account. No trading, no transfers, disconnect anytime.
                </p>
                {notice && (
                  <p className="mt-3 font-mono text-[11px] text-flag" role="status">
                    {notice}
                  </p>
                )}
                <div className="mt-5 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={authorize}
                    disabled={busy}
                    className="app-signal-button"
                  >
                    {busy ? "Redirecting" : "Authorise"}
                  </button>
                  <button
                    type="button"
                    onClick={cancel}
                    className="font-mono text-[11px] text-muted-foreground underline underline-offset-2 hover:text-ink"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
            {step === "picker" && (
              <>
                <p className="label-mono text-signal">Holdings detected</p>
                <h2 className="mt-2 font-display text-xl leading-tight">
                  Watch these from your sub-account?
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  Everything is ticked. Untick anything to leave it out.
                </p>
                <ul className="mt-4 max-h-56 space-y-2 overflow-y-auto">
                  {holdings.map((h) => (
                    <li key={h.ticker}>
                      <label className="flex cursor-pointer items-start gap-3 rounded-sm border border-border p-3 hover:border-signal">
                        <input
                          type="checkbox"
                          checked={checked.has(h.ticker)}
                          onChange={() => toggle(h.ticker)}
                          className="mt-0.5 accent-[#c8f04a]"
                          aria-label={`Watch ${h.ticker}`}
                        />
                        <span>
                          <span className="font-mono text-sm text-ink">{h.ticker}</span>
                          <span className="block font-mono text-[11px] text-muted-foreground">
                            {h.label}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <div className="mt-5 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={importSelected}
                    disabled={busy}
                    className="app-signal-button disabled:opacity-60"
                  >
                    {busy
                      ? "Importing"
                      : `Import selected${checked.size > 0 ? ` (${checked.size})` : ""}`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setStep("hidden")}
                    className="font-mono text-[11px] text-muted-foreground underline underline-offset-2 hover:text-ink"
                  >
                    Skip
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
