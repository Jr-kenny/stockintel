import { zeroGConfig, type ZeroGNetwork } from "./config";

/**
 * 0G Compute Router client — the LLM intelligence Runintel grades with.
 *
 * The Router is OpenAI-compatible: one endpoint, one key, every model.
 *   mainnet  → https://router-api.0g.ai/v1            (key from pc.0g.ai)
 *   testnet  → https://router-api-testnet.integratenetwork.work/v1
 *              (key from pc.testnet.0g.ai)
 *
 * Billing is on-chain against the key's deposited balance — completely
 * separate from the ZERO_G_PRIVATE_KEY used for Storage anchoring.
 * Without a key the app stays fully functional: callers fall back to the
 * deterministic grading engine and nothing makes network calls.
 */

export type ComputeRouterConfig = {
  /** True only when a router API key is present. */
  live: boolean;
  baseUrl: string;
  apiKey: string;
  /** All configured keys in priority order. First is primary, rest are fallbacks. */
  apiKeys: string[];
  model: string;
};

const ROUTER_BASE_URLS: Record<ZeroGNetwork, string> = {
  mainnet: "https://router-api.0g.ai/v1",
  testnet: "https://router-api-testnet.integratenetwork.work/v1",
};

/** Catalog IDs verified live against the router. Override with ZERO_G_COMPUTE_MODEL. */
const DEFAULT_MODEL = "gpt-5.6-luna";

/**
 * Second chances when the primary deployment returns empty content, in
 * order. glm-5 and deepseek-v4-flash are gone from this list: both returned
 * empty content on medium prompts and timed out on big generations across
 * two full timed runs.
 */
const FALLBACK_MODELS = ["glm-5.3-flash", "0gm-1.0-35b-a3b"];

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

export function computeRouterConfig(
  network: ZeroGNetwork = zeroGConfig().network,
): ComputeRouterConfig {
  const apiKeys = computeRouterKeys();
  return {
    live: apiKeys.length > 0,
    baseUrl: readEnv("ZERO_G_COMPUTE_BASE_URL") ?? ROUTER_BASE_URLS[network],
    apiKey: apiKeys[0] ?? "",
    apiKeys,
    model: readEnv("ZERO_G_COMPUTE_MODEL") ?? DEFAULT_MODEL,
  };
}

/**
 * Every configured Router key in priority order. Supports a comma-separated
 * list in ZERO_G_COMPUTE_API_KEYS plus the legacy single
 * ZERO_G_COMPUTE_API_KEY and numbered _2, _3, _4 suffixes. Duplicates are
 * dropped, so the same key in two slots counts once.
 */
export function computeRouterKeys(): string[] {
  const out: string[] = [];
  const push = (v: string | undefined) => {
    const t = v?.trim();
    if (t && !out.includes(t)) out.push(t);
  };
  for (const part of (readEnv("ZERO_G_COMPUTE_API_KEYS") ?? "").split(",")) push(part);
  push(readEnv("ZERO_G_COMPUTE_API_KEY"));
  for (let i = 2; i <= 9; i++) push(readEnv(`ZERO_G_COMPUTE_API_KEY_${i}`));
  return out;
}

/** True when the Router rejected the key itself rather than the request. */
function isKeyFailure(status: number, body: string): boolean {
  if (status === 401 || status === 402 || status === 403) return true;
  const t = body.toLowerCase();
  return (
    t.includes("insufficient") ||
    t.includes("out of funds") ||
    t.includes("out-of-funds") ||
    t.includes("balance") ||
    t.includes("quota") ||
    t.includes("invalid api key") ||
    t.includes("invalid key")
  );
}

export type ChatJsonOptions = {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** Injectable for tests — defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Skip the fallback model (callers with their own retry loops). */
  noFallback?: boolean;
};

export type ChatJsonResult = {
  content: string;
  requestId?: string | undefined;
  /** Approximate spend for this call, parsed from the Router's x_0g_trace billing (OG units). */
  costOg?: number | undefined;
};

/** Tolerant JSON extraction — models occasionally wrap JSON in prose or fences. */
export function parseJsonLoose(text: string): unknown {
  // Strip markdown fences first — models love ```json ... ```
  const stripped = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(stripped.slice(start, end + 1));
      } catch {
        // fall through
      }
    }
    throw new Error(`router returned non-JSON content: ${text.slice(0, 200)}`);
  }
}

function costFromTrace(trace: unknown): number | undefined {
  if (typeof trace !== "object" || trace === null) return undefined;
  const billing = (trace as { billing?: { total_cost?: unknown } }).billing;
  const raw = billing?.total_cost;
  if (typeof raw !== "string") return undefined;
  try {
    // Router reports costs in 0G wei-style integers.
    return Number(BigInt(raw)) / 1e18;
  } catch {
    return undefined;
  }
}

/** Pull the HTTP status and body back out of a `router <status>:` error. */
function httpFailure(error: unknown): { status: number | null; body: string } {
  if (!(error instanceof Error)) return { status: null, body: "" };
  const m = error.message.match(/^router (\d+):\s?([\s\S]*)$/);
  if (!m) return { status: null, body: "" };
  return { status: Number(m[1]), body: m[2] ?? "" };
}

/**
 * One JSON-mode chat completion through the Router. Throws on transport or
 * HTTP failure — callers decide whether that degrades the pipeline (grading
 * treats it as a no-op and keeps deterministic weights).
 */
export async function chatJson(opts: ChatJsonOptions): Promise<ChatJsonResult> {
  const config = computeRouterConfig();
  if (!config.live)
    throw new Error("0G Compute Router is not configured (no ZERO_G_COMPUTE_API_KEY)");

  const fetchImpl = opts.fetchImpl ?? fetch;
  const keys = config.apiKeys.length > 0 ? config.apiKeys : [config.apiKey];
  let lastError: unknown = null;

  for (let ki = 0; ki < keys.length; ki++) {
    const keyed = { ...config, apiKey: keys[ki]! };
    try {
      return await runCompletion(fetchImpl, keyed, opts, keyed.model);
    } catch (error) {
      // One flaky deployment shouldn't sink the run: walk the fallback
      // models when the primary comes back empty, same key.
      const empty =
        error instanceof Error && error.message === "router returned empty content";
      if (empty && !opts.noFallback) {
        for (const fallback of FALLBACK_MODELS) {
          if (fallback === keyed.model) continue;
          try {
            console.error(`primary model empty, retrying on ${fallback}`);
            return await runCompletion(fetchImpl, keyed, opts, fallback);
          } catch (fallbackError) {
            lastError = fallbackError;
          }
        }
      } else {
        lastError = error;
      }
      // Only roll to the next key when this key itself is the problem:
      // auth, payment, quota. Anything else is the request or the model,
      // and retrying it on another key just burns more money.
      const { status, body } = httpFailure(error);
      if (ki < keys.length - 1 && status !== null && isKeyFailure(status, body)) {
        console.error(`0G key ${ki + 1}/${keys.length} rejected (${status}), trying next key`);
        continue;
      }
      throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("0G request failed on every key");

  async function runCompletion(
    fetchImpl: typeof fetch,
    config: ComputeRouterConfig,
    opts: ChatJsonOptions,
    model: string,
  ): Promise<ChatJsonResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 90_000);
    try {
      const res = await fetchImpl(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: opts.system },
            { role: "user", content: opts.user },
          ],
          temperature: opts.temperature ?? 0,
          ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
          // NOTE: response_format json_object is intentionally NOT sent — the
          // router intermittently stops instantly with zero tokens when it is
          // set. Prompts demand JSON-only and parseJsonLoose tolerates fences.
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`router ${res.status}: ${body.slice(0, 300)}`);
      }

      const payload = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        x_0g_trace?: unknown;
      };
      const content = payload.choices?.[0]?.message?.content ?? "";
      if (!content.trim()) throw new Error("router returned empty content");

      // Normalize once here so every caller gets clean JSON: strip fences
      // and slice the object the way OpenRouter already does. Callers parse
      // with their own slices and salvage paths, which is where fenced
      // output used to die on our side rather than the model's.
      const stripped = content
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```\s*$/i, "")
        .trim();
      const start = stripped.indexOf("{");
      const end = stripped.lastIndexOf("}");
      const clean = start >= 0 && end > start ? stripped.slice(start, end + 1) : stripped;

      try {
        parseJsonLoose(clean); // validate early — callers rely on JSON coming back
      } catch {
        // Attach the raw text so callers can salvage complete fragments.
        const err = new Error(`router returned non-JSON content: ${content.slice(0, 200)}`);
        (err as { rawContent?: string }).rawContent = content;
        throw err;
      }

      const trace = payload.x_0g_trace as { request_id?: string } | undefined;
      return {
        content: clean,
        ...(trace?.request_id ? { requestId: trace.request_id } : {}),
        ...(costFromTrace(payload.x_0g_trace) !== undefined
          ? { costOg: costFromTrace(payload.x_0g_trace) }
          : {}),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
