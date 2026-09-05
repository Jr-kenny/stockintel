/**
 * Backfill Agentic IDs for registered grid agents that don't have one yet.
 *
 *   bun run scripts/backfill-agentic-ids.ts
 *
 * Mints one ERC-7857 identity per agent (owner = the agent's own wallet),
 * writes `0x7857:<tokenId>` into agents.agentic_id. Idempotent — skips
 * agents that already carry an id. Set DRY_RUN=true to preview only.
 */
import { db, ensureSchema } from "../src/lib/db";
import { agents } from "../src/lib/db/schema";
import { eq } from "drizzle-orm";
import { agenticIdConfig, mintAgentIdentity } from "../src/lib/base/agentic-id";

await ensureSchema();

const config = agenticIdConfig();
if (!config.live) {
  console.error("Agentic ID not live — set BASE_SIGNER_KEY (and optionally AGENTIC_ID_CONTRACT).");
  process.exit(1);
}
console.log("contract:", config.address);

const rows = await db.select().from(agents);
// Placeholder wallets (0x…0001-style sample rows) get no identity — nobody
// holds that key, the token would be stuck forever.
const PLACEHOLDER_LIMIT = 1000n;
const isPlaceholder = (wallet: string) => {
  try {
    return BigInt(wallet) < PLACEHOLDER_LIMIT;
  } catch {
    return true;
  }
};
const pending = rows.filter((a) => !a.agenticId && !isPlaceholder(a.wallet));
console.log(`${rows.length} agents total, ${pending.length} without an Agentic ID`);

for (const agent of pending) {
  if (process.env.DRY_RUN === "true") {
    console.log(`[dry-run] would mint for ${agent.name} (${agent.id}) → ${agent.wallet}`);
    continue;
  }
  try {
    const minted = await mintAgentIdentity({
      agentDbId: agent.id,
      name: agent.name,
      specialty: agent.specialty || undefined,
      wallet: agent.wallet,
      endpoint: agent.endpoint,
    });
    await db
      .update(agents)
      .set({ agenticId: `0x7857:${minted.tokenId}` })
      .where(eq(agents.id, agent.id));
    console.log(`✓ ${agent.name}: token ${minted.tokenId} → ${minted.explorerUrl}`);
  } catch (err) {
    console.error(`✗ ${agent.name}:`, err instanceof Error ? err.message : err);
  }
}

console.log("backfill done.");
process.exit(0);
