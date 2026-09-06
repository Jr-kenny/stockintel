/**
 * Virtuals ACP agent — buyer-side node for specialist intel from the
 * Agent Commerce Protocol registry.
 *
 *   bun scripts/acp-agent.ts
 *
 * Requires: ACP_PRIVATE_KEY (see .env.example). Without it this script exits
 * with a hint; the platform keeps running on the native connector protocol.
 */
import { createAcpAgent, acpChain } from "../src/lib/virtuals/acp";
import type { JobSession, JobRoomEntry } from "@virtuals-protocol/acp-node-v2";

if (!process.env["ACP_PRIVATE_KEY"]) {
  console.error(
    "ACP not configured — set ACP_PRIVATE_KEY. " +
      "The platform keeps running without ACP; this node is an enhancement.",
  );
  process.exit(1);
}

const agent = await createAcpAgent();

agent.on("entry", async (session: JobSession, entry: JobRoomEntry) => {
  try {
    if (entry.kind === "system") {
      switch (entry.event.type) {
        case "budget.set":
          // Buyer side: a specialist proposed a price for our intel request.
          console.log(`[acp] job ${session.jobId}: budget proposed`);
          break;
        case "job.submitted":
          // Buyer side: deliverable arrived — accept and release escrow.
          console.log(`[acp] job ${session.jobId}: deliverable submitted`);
          await session.complete("Evidence accepted");
          break;
        case "job.completed":
          console.log(`[acp] job ${session.jobId} completed — escrow released`);
          break;
        default:
          break;
      }
    }
  } catch (err) {
    console.error("[acp] entry handler error:", err);
  }
});

await agent.start();
console.log(`[acp] PrimeBaseLayer ACP node live on chain ${acpChain().id}`);

// Keep the process alive; Ctrl-C to stop.
setInterval(() => {}, 1 << 30);
