import { createHash } from "node:crypto";
import { baseConfig, baseExplorerTx } from "./config";

/**
 * Canonical record Prime Base Layer anchors on Base.
 * Every evidence claim that survives clustering can be serialized to this
 * shape; the sha256 commitment becomes its permanent content identifier,
 * written into the calldata of a Base transaction.
 */
export type AnchorableRecord = {
  kind: "evidence" | "prediction" | "settlement" | "opportunity";
  id: string;
  agent: string;
  claim: string;
  confidence?: number | undefined;
  evidence?: { item: string; source: string; observed: string }[] | undefined;
  inquiry?: string | undefined;
  observedAt: string;
};

export type AnchorResult = {
  mode: "live" | "sandbox";
  rootHash: string;
  txHash?: string;
  explorerUrl?: string;
};

export function serializeRecord(record: AnchorableRecord): Uint8Array {
  // No wall-clock fields here: the commitment must be reproducible from the
  // record alone so anyone can recompute and verify it against Base calldata.
  return new TextEncoder().encode(
    JSON.stringify({
      schema: "prime-layer.evidence/v1",
      ...record,
    }),
  );
}

/** Deterministic local pre-hash — also the sandbox root so ids are stable across modes. */
export function localRoot(record: AnchorableRecord): string {
  return `0x${createHash("sha256").update(serializeRecord(record)).digest("hex")}`;
}

/**
 * One signer = one nonce stream. Concurrent anchors collide on-chain
 * ("replacement transaction underpriced"), so anchors are serialized.
 */
let anchorQueue: Promise<unknown> = Promise.resolve();
function enqueueAnchor<T>(task: () => Promise<T>): Promise<T> {
  const run = anchorQueue.then(task, task);
  anchorQueue = run.catch(() => undefined);
  return run;
}

/**
 * Anchors a record on Base: the record's sha256 commitment goes into the
 * calldata of a zero-value transaction from the platform signer. Anyone can
 * verify the commitment forever via RPC or the block explorer — no contract
 * deployment, no storage rent, finality in seconds on Base.
 *
 * Live mode requires BASE_SIGNER_KEY (funded on the target network).
 * Without it we return a sandbox anchor: the deterministic sha256 root of
 * the exact bytes that *would* be committed — honest about being local.
 */
export async function anchorRecord(record: AnchorableRecord): Promise<AnchorResult> {
  const config = baseConfig();

  if (!config.live) {
    return { mode: "sandbox", rootHash: localRoot(record) };
  }

  return enqueueAnchor(async () => {
    const { ethers } = await import("ethers");
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const signer = new ethers.Wallet(config.privateKey!, provider);

    const rootHash = localRoot(record);
    // Self-send with the commitment as calldata: permanent, verifiable,
    // and cheap on Base (~cents even at mainnet gas).
    const tx = await signer.sendTransaction({
      to: await signer.getAddress(),
      value: 0n,
      data: rootHash as `0x${string}`,
    });
    const receipt = await tx.wait();

    return {
      mode: "live",
      rootHash,
      txHash: receipt!.hash,
      explorerUrl: baseExplorerTx(receipt!.hash, config.network),
    } satisfies AnchorResult;
  });
}
