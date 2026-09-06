/**
 * Agent OS sessions for StockIntel.
 *
 * Binance only recognises its approved agent clients, so StockIntel never
 * acts as an OAuth client itself. There is no authorize redirect and no
 * callback. A session reaches this server exactly one way: a token minted
 * inside the operator's own supported client session (Claude Code, Cursor,
 * ChatGPT, Codex, VS Code), set as BINANCE_MCP_TOKEN. Every workspace then
 * shares that live context for market data. Account lines stay scoped to
 * workspaces holding their own token, which only the env key provides.
 *
 * Everyone else needs nothing: public market context flows with no key,
 * and calling agents bring their own exchange leg verbatim (see inject.ts).
 */

export function appOrigin(): string {
  const raw =
    process.env["PUBLIC_APP_URL"]?.trim() ||
    process.env["PUBLIC_SUBMIT_URL"]?.trim() ||
    "https://stockintelislive.vercel.app";
  return raw.replace(/\/+$/, "");
}

/** Usable market token: the shared env key, or null. */
export async function resolveAgentOsToken(_identity?: string | null): Promise<string | null> {
  const env = process.env["BINANCE_MCP_TOKEN"]?.trim();
  return env && env.length > 10 ? env : null;
}
