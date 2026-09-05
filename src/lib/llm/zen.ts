/**
 * OpenCode Zen backup for thesis writing.
 * Supports both Zen shapes:
 * - chat/completions models: glm-5, kimi-k2.5, deepseek-v4-flash, minimax,
 *   mimo-v2.5-free, ling, nemotron free, big-pickle
 *   -> POST https://opencode.ai/zen/v1/chat/completions
 * - responses models: muse-spark-1.3-contributor-free, gpt-5.x, grok, etc
 *   -> POST https://opencode.ai/zen/v1/responses
 *
 * Set OPENCODE_ZEN_API_KEY from https://opencode.ai/auth.
 * Override with ZEN_MODEL, default mimo-v2.5-free (free, chat endpoint).
 */

export type ZenResult = { content: string; model: string };

function readEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

export function zenConfig(): { live: boolean; apiKey: string; model: string } {
  const apiKey = readEnv("OPENCODE_ZEN_API_KEY") ?? "";
  const model =
    readEnv("ZEN_MODEL") ?? readEnv("OPENCODE_ZEN_MODEL") ?? "muse-spark-1.3-contributor-free";
  return { live: apiKey.length > 0, apiKey, model };
}

const RESPONSES_MODELS = [
  "muse-spark",
  "gpt-5",
  "gpt-5.1",
  "gpt-5.2",
  "gpt-5.3",
  "gpt-5.4",
  "gpt-5.5",
  "gpt-5.6",
  "grok",
];

function usesResponsesEndpoint(model: string): boolean {
  const m = model.toLowerCase();
  return RESPONSES_MODELS.some((p) => m.startsWith(p));
}

function stripFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

function extractJson(content: string): string {
  const stripped = stripFences(content);
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start < 0 || end <= start) {
    const err = new Error(`zen returned non-JSON content: ${content.slice(0, 200)}`);
    (err as { rawContent?: string }).rawContent = content;
    throw err;
  }
  try {
    JSON.parse(stripped.slice(start, end + 1));
  } catch {
    const err = new Error(`zen returned non-JSON content: ${content.slice(0, 200)}`);
    (err as { rawContent?: string }).rawContent = content;
    throw err;
  }
  return stripped.slice(start, end + 1);
}

function responsesText(payload: unknown): string {
  const out = payload as {
    output_text?: unknown;
    output?: { content?: { type?: string; text?: string }[] }[];
  };
  if (typeof out.output_text === "string" && out.output_text.trim()) return out.output_text;
  const parts: string[] = [];
  for (const item of out.output ?? []) {
    for (const c of item.content ?? []) {
      if (typeof c.text === "string" && c.text.trim()) parts.push(c.text);
    }
  }
  return parts.join("\n").trim();
}

export async function chatJsonZen(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  model?: string;
}): Promise<ZenResult> {
  const config = zenConfig();
  if (!config.live) throw new Error("Zen not configured (no OPENCODE_ZEN_API_KEY)");
  const model = opts.model ?? config.model;
  if (usesResponsesEndpoint(model)) {
    return runResponses(config.apiKey, model, opts);
  }
  return runChat(config.apiKey, model, opts);
}

async function runChat(
  apiKey: string,
  model: string,
  opts: { system: string; user: string; maxTokens?: number; temperature?: number; timeoutMs?: number },
): Promise<ZenResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
  try {
    const res = await fetch("https://opencode.ai/zen/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens ?? 2200,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`zen chat ${res.status}: ${body.slice(0, 300)}`);
    }
    const payload = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = payload.choices?.[0]?.message?.content ?? "";
    if (!content.trim()) throw new Error("zen returned empty content");
    return { content: extractJson(content), model };
  } finally {
    clearTimeout(timer);
  }
}

async function runResponses(
  apiKey: string,
  model: string,
  opts: { system: string; user: string; maxTokens?: number; temperature?: number; timeoutMs?: number },
): Promise<ZenResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
  try {
    const res = await fetch("https://opencode.ai/zen/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        instructions: opts.system,
        input: opts.user,
        temperature: opts.temperature ?? 0.3,
        max_output_tokens: opts.maxTokens ?? 2200,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`zen responses ${res.status}: ${body.slice(0, 300)}`);
    }
    const payload = await res.json();
    const text = responsesText(payload);
    if (!text.trim()) throw new Error("zen returned empty content");
    return { content: extractJson(text), model };
  } finally {
    clearTimeout(timer);
  }
}
