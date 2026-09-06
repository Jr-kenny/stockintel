/**
 * Provider order for every LLM pass in the orchestrator.
 *
 * OpenRouter leads. 0G Compute Router is the fallback, not the primary: on the
 * deeper schemas (connect, report) it returned empty content and fenced JSON
 * often enough to cost a run, and a free OpenRouter model does the same work
 * more reliably. Zen sits last as a third option when a key is present.
 *
 * Default model is minimax/minimax-m3:free, chosen by probing the real connect
 * contract with a 7-event payload: 2/2 clean parses, 26-32s, ~2400 completion
 * tokens against a 4000 cap, and every chain joined two or more events.
 * nemotron-3-super passed once then truncated at the cap; glm-5.2 and gemma-4
 * were rate limited; deepseek-r1 and qwen3-coder are no longer free.
 *
 * One place to change this, so the passes cannot drift apart.
 */

import { chatJson } from "@/lib/0g/compute-router";
import { chatJsonOpenRouter, openRouterConfig } from "@/lib/llm/openrouter";
import { chatJsonZen, zenConfig } from "@/lib/llm/zen";

export type JsonCaller = (opts: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}) => Promise<{ content: string }>;

export type ProviderOption = { fn: JsonCaller; name: string };

/**
 * Providers in the order they should be tried. OpenRouter first when a key is
 * configured, then 0G, then Zen.
 *
 * 0G is always included even without an explicit check: computeRouterConfig
 * gates itself and throws a clear error when unset, and keeping it in the chain
 * means a run still completes if OpenRouter is rate limited.
 */
export function jsonProviders(): ProviderOption[] {
  const order: ProviderOption[] = [];
  if (openRouterConfig().live) {
    order.push({ fn: chatJsonOpenRouter, name: `openrouter:${openRouterConfig().model}` });
  }
  order.push({ fn: chatJson, name: "0G" });
  if (zenConfig().live) order.push({ fn: chatJsonZen, name: "zen" });
  return order;
}

/** For the status surfaces: which provider leads and what the chain looks like. */
export function providerChain(): { primary: string; chain: string[] } {
  const chain = jsonProviders().map((p) => p.name);
  return { primary: chain[0] ?? "none", chain };
}
