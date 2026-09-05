import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The single source of how StockIntel thinks. Every LLM pass in the
 * orchestrator (hypotheses, grading, synthesis) reads soul.md first and
 * appends it to its prompt with override precedence.
 *
 * Code keeps only mechanics: JSON contracts, chunking, clustering, budgets,
 * deterministic fallbacks. Judgment lives here.
 */

let cached: string | null = null;

export async function loadSoul(): Promise<string> {
  if (cached !== null) return cached;
  try {
    cached = await readFile(path.join(process.cwd(), "soul.md"), "utf8");
  } catch {
    cached =
      "Talk like a person. Thesis first, price second. Facts and inference stay separate. Always include source links.";
  }
  return cached;
}

/** Append the doctrine to a task prompt. Soul wins on any conflict. */
export async function guidedSystem(base: string): Promise<string> {
  const soul = await loadSoul();
  return `${base}\n\nTHINKING DOCTRINE (soul.md — overrides any conflicting instruction above):\n${soul}`;
}
