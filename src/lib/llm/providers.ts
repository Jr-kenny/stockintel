/**
 * Provider order for every LLM pass in the orchestrator.
 *
 * 0G Compute Router leads. OpenRouter sits behind it as the free fallback.
 *
 * 0G leads because it follows the deep schemas (connect, report) more
 * closely than the free OpenRouter options probed so far, and because its
 * spend is on keys we control directly. OpenRouter's free default went paid
 * (minimax-m3:free 404), nemotron-3-super answers but invents its own shape,
 * glm-5.2 and gemma-4 were rate limited.
 *
 * Zen was third in this chain until 2026-09-13, when every call started
 * failing with a free-tier session error. It now sits out entirely rather
 * than taxing every failed chunk with another round trip. Re-add it here if
 * the key ever behaves.
 *
 * 0G rolls across every configured key before the chain moves on: primary
 * ZERO_G_COMPUTE_API_KEY, then _2, _3 and the rest, or a comma-separated
 * ZERO_G_COMPUTE_API_KEYS list. Only key-level rejections (auth, payment,
 * quota) roll to the next key. Anything else throws straight through so a
 * bad request never burns every key at once.
 *
 * One place to change this, so the passes cannot drift apart.
 */

import { chatJson } from "@/lib/0g/compute-router";
import { chatJsonOpenRouter, openRouterConfig } from "@/lib/llm/openrouter";

export type JsonCaller = (opts: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}) => Promise<{ content: string }>;

export type ProviderOption = { fn: JsonCaller; name: string };

/**
 * Providers in the order they should be tried. 0G first when a key is
 * configured, then OpenRouter.
 *
 * 0G throws a clear error when unset, so with no key the chain simply starts
 * at OpenRouter instead of failing the run.
 */
export function jsonProviders(): ProviderOption[] {
  const order: ProviderOption[] = [];
  order.push({ fn: chatJson, name: "0G" });
  if (openRouterConfig().live) {
    order.push({ fn: chatJsonOpenRouter, name: `openrouter:${openRouterConfig().model}` });
  }
  return order;
}

/** For the status surfaces: which provider leads and what the chain looks like. */
export function providerChain(): { primary: string; chain: string[] } {
  const chain = jsonProviders().map((p) => p.name);
  return { primary: chain[0] ?? "none", chain };
}
