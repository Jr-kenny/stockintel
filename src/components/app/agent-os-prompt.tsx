import { useCallback, useEffect, useState } from "react";
import { PrivyIdentity, type PrivyIdentityInfo } from "@/components/app/privy-identity";
import { importAgentOsHoldings } from "@/lib/binance/fns";
import { extractTicker } from "@/lib/binance/market";

type Step = "hidden" | "explain" | "picker";

const dismissKey = (identity: string) => `agentos-prompt-dismissed:${identity}`;

type Holding = { ticker: string; label: string };

function detectHoldings(text: string): Holding[] {
  const seen = new Set<string>();
  const out: Holding[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const ticker = extractTicker(line);
    if (!ticker || seen.has(ticker)) continue;
    seen.add(ticker);
    out.push({ ticker, label: line.slice(0, 90) });
  }
  return out.slice(0, 20);
}

/**
 * Post-login holdings prompt, mounted once in the workspace layout.
 *
 * Binance only recognises its approved agent clients, so there is no
 * authorize button here. The workspace copies its balances out of its own
 * Binance tools once, the app detects tickers, every box starts ticked,
 * untick to reject, import the rest. Cancel dismisses quietly and the run
 * continues on public data.
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
  const [pasted, setPasted] = useState("");
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!identity) {
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
  }, [identity]);

  // Workspace menu "Watch holdings" reopens the prompt on demand.
  useEffect(() => {
    if (!identity) return;
    const open = () => {
      setNotice(null);
      setStep("explain");
    };
    window.addEventListener("agentos:open", open);
    return () => window.removeEventListener("agentos:open", open);
  }, [identity]);

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

  const detect = useCallback(() => {
    const found = detectHoldings(pasted);
    if (found.length === 0) {
      setNotice("No tickers detected in that paste. Copy your balances output and try again.");
      return;
    }
    setNotice(null);
    setHoldings(found);
    setChecked(new Set(found.map((h) => h.ticker)));
    setStep("picker");
  }, [pasted]);

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
      cancel();
      return;
    }
    setBusy(true);
    void importAgentOsHoldings({ data: { identity, tickers } })
      .then(({ added }) => {
        setNotice(
          added.length > 0
            ? `Watching ${added.join(", ")}. Research now reads against your positions.`
            : "Those are already on your watchlist.",
        );
        setStep("hidden");
        setBusy(false);
      })
      .catch(() => setBusy(false));
  }, [identity, busy, checked, cancel]);

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
          aria-label="Watch your holdings"
        >
          <div className="surface-dark w-full max-w-md p-6">
            {step === "explain" && (
              <>
                <p className="label-mono text-signal">Watch your holdings</p>
                <h2 className="mt-2 font-display text-xl leading-tight">
                  Let research speak to your positions
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  In your own agent session with the Binance tools connected, ask for your
                  sub-account balances. Paste the output below and StockIntel pulls the tickers onto
                  your watchlist, then ranks every event against what you actually hold. Nothing
                  leaves your workspace. Paste once, or add tickers by hand on the watchlist page
                  instead.
                </p>
                <textarea
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  placeholder="Paste your balances output here"
                  rows={4}
                  aria-label="Balances output"
                  className="mt-4 w-full rounded-sm border border-input bg-card px-3 py-2 font-mono text-xs text-ink placeholder:text-ink-muted"
                />
                {notice && (
                  <p className="mt-2 font-mono text-[11px] text-flag" role="status">
                    {notice}
                  </p>
                )}
                <div className="mt-4 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={detect}
                    disabled={busy || !pasted.trim()}
                    className="app-signal-button disabled:opacity-60"
                  >
                    Detect holdings
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
                    onClick={cancel}
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
