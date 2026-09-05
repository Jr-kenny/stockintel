/**
 * OpenRouter thesis provider. Set OPENROUTER_API_KEY to enable.
 * Defaults to a free model (GLM family writes our thesis JSON reliably),
 * override with OPENROUTER_MODEL or PRIME_GRADE_MODEL.
 * Other free candidates if the default ever degrades:
 * minimax/minimax-m3:free, nvidia/nemotron-3-super-120b-a12b:free,
 * google/gemma-4-31b-it:free, minimax/minimax-m2.7:free.
 */

export type OpenRouterResult = {
  content: string;
  model: string;
};

function readEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

export function openRouterConfig(): { live: boolean; apiKey: string; model: string } {
  const apiKey = readEnv("OPENROUTER_API_KEY") ?? "";
  const model =
    readEnv("OPENROUTER_MODEL") ??
    readEnv("PRIME_GRADE_MODEL") ??
    "z-ai/glm-5.2:free";
  return { live: apiKey.length > 0, apiKey, model };
}

function stripFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

export async function chatJsonOpenRouter(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}): Promise<OpenRouterResult> {
  const config = openRouterConfig();
  if (!config.live) throw new Error("OpenRouter not configured (no OPENROUTER_API_KEY)");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
        "HTTP-Referer": "https://stockintel.app",
        "X-Title": "StockIntel",
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens ?? 2200,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`openrouter ${res.status}: ${body.slice(0, 300)}`);
    }
    const payload = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = payload.choices?.[0]?.message?.content ?? "";
    if (!content.trim()) throw new Error("openrouter returned empty content");
    const stripped = stripFences(content);
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start < 0 || end <= start) {
      const err = new Error(`openrouter returned non-JSON content: ${content.slice(0, 200)}`);
      (err as { rawContent?: string }).rawContent = content;
      throw err;
    }
    try {
      JSON.parse(stripped.slice(start, end + 1));
    } catch {
      const err = new Error(`openrouter returned non-JSON content: ${content.slice(0, 200)}`);
      (err as { rawContent?: string }).rawContent = content;
      throw err;
    }
    return { content: stripped.slice(start, end + 1), model: config.model };
  } finally {
    clearTimeout(timer);
  }
}
