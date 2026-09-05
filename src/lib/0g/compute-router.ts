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
  model: string;
};

const ROUTER_BASE_URLS: Record<ZeroGNetwork, string> = {
  mainnet: "https://router-api.0g.ai/v1",
  testnet: "https://router-api-testnet.integratenetwork.work/v1",
};

/** Catalog IDs verified live against the router. Override with ZERO_G_COMPUTE_MODEL. */
const DEFAULT_MODEL = "glm-5";

/** Second chance when the primary deployment returns empty content. */
const FALLBACK_MODEL = "deepseek-v4-flash";

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

export function computeRouterConfig(
  network: ZeroGNetwork = zeroGConfig().network,
): ComputeRouterConfig {
  const apiKey = readEnv("ZERO_G_COMPUTE_API_KEY") ?? "";
  return {
    live: apiKey.length > 0,
    baseUrl: readEnv("ZERO_G_COMPUTE_BASE_URL") ?? ROUTER_BASE_URLS[network],
    apiKey,
    model: readEnv("ZERO_G_COMPUTE_MODEL") ?? DEFAULT_MODEL,
  };
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

  try {
    return await runCompletion(fetchImpl, config, opts, config.model);
  } catch (error) {
    // One flaky deployment shouldn't sink the run: retry once on the
    // fallback model when the primary comes back empty.
    const empty =
      error instanceof Error && error.message === "router returned empty content";
    if (!empty || opts.noFallback || config.model === FALLBACK_MODEL) throw error;
    console.error(`primary model empty, retrying on ${FALLBACK_MODEL}`);
    return runCompletion(fetchImpl, config, opts, FALLBACK_MODEL);
  }

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

      try {
        parseJsonLoose(content); // validate early — callers rely on JSON coming back
      } catch {
        // Attach the raw text so callers can salvage complete fragments.
        const err = new Error(`router returned non-JSON content: ${content.slice(0, 200)}`);
        (err as { rawContent?: string }).rawContent = content;
        throw err;
      }

      const trace = payload.x_0g_trace as { request_id?: string } | undefined;
      return {
        content,
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
