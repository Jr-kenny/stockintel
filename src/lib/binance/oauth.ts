import { createHash, randomBytes } from "node:crypto";
import { db, ensureSchema, nowIso } from "@/lib/db";
import { binanceOauthStates, binanceTokens } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * Binance Agent OS OAuth for StockIntel itself (Track A).
 *
 * The MCP server speaks OAuth user authorization: the workspace owner
 * clicks Connect, authorizes read-only scopes on Binance, and the app
 * exchanges the code (PKCE, public client, no secret) for a user token.
 * That token drives the Agent OS market check per workspace. No trade or
 * transfer scopes are ever requested.
 *
 * Endpoint discovery follows the MCP authorization spec (RFC 8414 +
 * RFC 7591 style): the resource server publishes its authorization
 * server, so hardcoded authorize and token URLs are only a last resort.
 * Override either with BINANCE_OAUTH_AUTHORIZE_URL or
 * BINANCE_OAUTH_TOKEN_URL when Binance publishes a new address.
 */

const FALLBACK_AUTHORIZE_URL = "https://accounts.binance.com/agentic-oauth/authorize";
const FALLBACK_TOKEN_URL = "https://accounts.binance.com/oauth-agentic/token";

function mcpUrl(): string {
  return process.env["AGENT_OS_MCP_URL"]?.trim() || "https://www.binance.com/mcp/agentic";
}

let endpointCache: { authorize: string; token: string } | null = null;

/** Discover the OAuth endpoints instead of trusting a hardcoded snapshot. */
export async function discoverOAuthEndpoints(): Promise<{ authorize: string; token: string }> {
  const envAuthorize = process.env["BINANCE_OAUTH_AUTHORIZE_URL"]?.trim();
  const envToken = process.env["BINANCE_OAUTH_TOKEN_URL"]?.trim();
  if (envAuthorize && envToken) return { authorize: envAuthorize, token: envToken };
  if (endpointCache) return endpointCache;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const res = await fetch(`${mcpUrl()}/.well-known/oauth-protected-resource`, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (res.ok) {
        const meta = (await res.json()) as { authorization_servers?: string[] };
        const server = meta.authorization_servers?.[0]?.replace(/\/+$/, "");
        if (server) {
          const asRes = await fetch(`${server}/.well-known/oauth-authorization-server`, {
            signal: controller.signal,
            headers: { accept: "application/json" },
          });
          if (asRes.ok) {
            const asMeta = (await asRes.json()) as {
              authorization_endpoint?: string;
              token_endpoint?: string;
            };
            if (asMeta.authorization_endpoint && asMeta.token_endpoint) {
              endpointCache = {
                authorize: asMeta.authorization_endpoint,
                token: asMeta.token_endpoint,
              };
              return endpointCache;
            }
          }
        }
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Discovery blocked (edge firewall often challenges datacenter IPs).
    // Fall through to env overrides, then the documented fallback.
  }
  endpointCache = {
    authorize: envAuthorize ?? FALLBACK_AUTHORIZE_URL,
    token: envToken ?? FALLBACK_TOKEN_URL,
  };
  return endpointCache;
}

export function appOrigin(): string {
  const raw =
    process.env["PUBLIC_APP_URL"]?.trim() ||
    process.env["PUBLIC_SUBMIT_URL"]?.trim() ||
    "https://stockintel-eight.vercel.app";
  return raw.replace(/\/+$/, "");
}

export function binanceClientId(): string {
  return `${appOrigin()}/api/binance/client-metadata`;
}

export function binanceRedirectUri(): string {
  return `${appOrigin()}/api/binance/callback`;
}

/** Public client metadata document served at the client_id URL. */
export function clientMetadataDoc(): Record<string, unknown> {
  const origin = appOrigin();
  return {
    client_id: `${origin}/api/binance/client-metadata`,
    client_name: "StockIntel",
    redirect_uris: [`${origin}/api/binance/callback`],
    grant_types: ["authorization_code"],
    response_types: ["code"],
    scope: "read",
    token_endpoint_auth_method: "none",
  };
}

const b64u = (buf: Buffer): string =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Start a connect flow. Any signed-in workspace can link its own sub-account. */
export async function beginBinanceConnect(identity: string): Promise<{ url: string }> {
  await ensureSchema();
  const verifier = b64u(randomBytes(32));
  const challenge = b64u(createHash("sha256").update(verifier).digest());
  const state = `st_${b64u(randomBytes(16))}`;
  await db.insert(binanceOauthStates).values({
    state,
    identity,
    verifier,
    createdAt: nowIso(),
  });
  const params = new URLSearchParams({
    response_type: "code",
    client_id: binanceClientId(),
    redirect_uri: binanceRedirectUri(),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  const { authorize } = await discoverOAuthEndpoints();
  return { url: `${authorize}?${params.toString()}` };
}

/** Exchange a callback code for tokens and store them on the workspace. */
export async function completeBinanceConnect(
  code: string,
  state: string,
): Promise<{ identity: string }> {
  await ensureSchema();
  const [row] = await db
    .select()
    .from(binanceOauthStates)
    .where(eq(binanceOauthStates.state, state));
  if (!row) throw new Error("Unknown or expired connect request. Start again from the app.");
  if (Date.now() - Date.parse(row.createdAt) > 10 * 60 * 1000) {
    await db.delete(binanceOauthStates).where(eq(binanceOauthStates.state, state));
    throw new Error("Connect request expired. Start again from the app.");
  }
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: binanceRedirectUri(),
    client_id: binanceClientId(),
    code_verifier: row.verifier,
  });
  const { token: tokenUrl } = await discoverOAuthEndpoints();
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Binance token exchange failed: ${text.slice(0, 160)}`);
  }
  const tok = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!tok.access_token) throw new Error("Binance returned no access token.");
  const ts = nowIso();
  await db
    .insert(binanceTokens)
    .values({
      identity: row.identity,
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token ?? null,
      expiresAt: tok.expires_in ? new Date(Date.now() + tok.expires_in * 1000).toISOString() : null,
      scope: tok.scope ?? null,
      updatedAt: ts,
    })
    .onConflictDoUpdate({
      target: binanceTokens.identity,
      set: {
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token ?? null,
        expiresAt: tok.expires_in
          ? new Date(Date.now() + tok.expires_in * 1000).toISOString()
          : null,
        scope: tok.scope ?? null,
        updatedAt: ts,
      },
    });
  await db.delete(binanceOauthStates).where(eq(binanceOauthStates.state, state));
  return { identity: row.identity };
}

/** Token stored for one workspace only. No env, no fallback. */
export async function workspaceTokenFor(identity: string): Promise<string | null> {
  try {
    await ensureSchema();
    const [row] = await db.select().from(binanceTokens).where(eq(binanceTokens.identity, identity));
    if (row?.accessToken) {
      if (!row.expiresAt || Date.parse(row.expiresAt) > Date.now() + 60_000) {
        return row.accessToken;
      }
      // Expired but refreshable: one best-effort refresh, then fall through.
      if (row.refreshToken) {
        const refreshed = await refreshAgentOsToken(identity, row.refreshToken).catch(() => null);
        if (refreshed) return refreshed;
      }
    }
  } catch {
    // fall through to null
  }
  return null;
}

/**
 * Usable market token: this workspace first, then the global env token.
 * Each workspace links its own Agentic sub-account. Self-hosters set one
 * BINANCE_MCP_TOKEN instead and every readout carries live context.
 */
export async function resolveAgentOsToken(identity?: string | null): Promise<string | null> {
  if (identity) {
    const own = await workspaceTokenFor(identity);
    if (own) return own;
  }
  const env = process.env["BINANCE_MCP_TOKEN"]?.trim();
  if (env && env.length > 10) return env;
  return null;
}

/** Best-effort refresh of an expired workspace token. Returns the new token or null. */
async function refreshAgentOsToken(identity: string, refreshToken: string): Promise<string | null> {
  const { token: tokenUrl } = await discoverOAuthEndpoints();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: binanceClientId(),
  });
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) return null;
  const tok = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!tok.access_token) return null;
  await db
    .update(binanceTokens)
    .set({
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token ?? refreshToken,
      expiresAt: tok.expires_in ? new Date(Date.now() + tok.expires_in * 1000).toISOString() : null,
      scope: tok.scope ?? null,
      updatedAt: nowIso(),
    })
    .where(eq(binanceTokens.identity, identity));
  return tok.access_token;
}

export async function binanceConnectStatus(
  identity: string,
): Promise<{ connected: boolean; scope?: string }> {
  await ensureSchema();
  const [row] = await db.select().from(binanceTokens).where(eq(binanceTokens.identity, identity));
  if (!row?.accessToken) return { connected: false };
  if (row.expiresAt && Date.parse(row.expiresAt) <= Date.now() + 60_000) {
    return { connected: false };
  }
  return { connected: true, ...(row.scope ? { scope: row.scope } : {}) };
}

export async function disconnectBinance(identity: string): Promise<void> {
  await ensureSchema();
  await db.delete(binanceTokens).where(eq(binanceTokens.identity, identity));
}
