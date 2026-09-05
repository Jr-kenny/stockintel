import { createHash } from "node:crypto";
import { baseConfig } from "./config";

/**
 * Agentic ID (ERC-7857) on Base — every agent on the grid gets a real onchain
 * identity NFT whose intelligent-data commitment pins who it claims to be.
 *
 * Base has no network-wide pre-deployed ERC-7857, so this targets OUR deployed
 * contract: set AGENTIC_ID_CONTRACT after deploying the iMint-compatible
 * identity contract (see scripts/ — deploy target for the build window).
 * One funded signer (BASE_SIGNER_KEY) covers mints, anchors and payroll.
 *
 * Failure posture mirrors the rest of the stack: identity is an enhancement.
 * If minting fails (RPC down, out of gas) the agent stays fully registered
 * and functional — the row just keeps agenticId empty until a later cycle or
 * the manual backfill mints it.
 */

const CONTRACT_ABI = [
  "function iMint(address to, (string dataDescription, bytes32 dataHash)[] datas) payable returns (uint256)",
  "function mintFee() view returns (uint256)",
  "function getIntelligentDatas(uint256 tokenId) view returns ((string dataDescription, bytes32 dataHash)[])",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
];

type IntelligentData = { dataDescription: string; dataHash: string };
type AgenticContract = {
  mintFee(): Promise<bigint>;
  iMint(
    to: string,
    datas: [string, string][],
    opts?: { value?: bigint },
  ): Promise<{ wait(): Promise<{ hash: string; logs: { topics: string[]; data: string }[] }> }>;
  getIntelligentDatas(tokenId: bigint): Promise<IntelligentData[]>;
};

export type AgenticIdConfig = {
  live: boolean;
  address: string;
};

export function agenticIdConfig(): AgenticIdConfig {
  const raw = process.env["AGENTIC_ID_CONTRACT"];
  const disabled = process.env["AGENTIC_ID_DISABLED"] === "true";
  const { privateKey } = baseConfig();
  const address = raw?.trim() ?? "";
  return {
    // Live needs a deployed contract target and the shared funded signer.
    live: Boolean(privateKey) && address.length > 0 && !disabled,
    address,
  };
}

export type AgentIdentityInput = {
  /** Stable internal id (agt-…). Part of the committed data hash. */
  agentDbId: string;
  name: string;
  specialty?: string | undefined;
  /** The agent's own wallet becomes the token owner — they hold their identity. */
  wallet: string;
  endpoint: string;
};

export type MintedIdentity = {
  tokenId: string;
  txHash: string;
  dataHash: string;
  owner: string;
  explorerUrl: string;
};

/**
 * Canonical commitment over the agent's public profile. Anyone can verify the
 * NFT's intelligent data against what the network shows for this agent.
 */
export function agentDataHash(input: AgentIdentityInput): string {
  const canonical = JSON.stringify({
    schema: "prime-layer.agent/v1",
    id: input.agentDbId,
    name: input.name,
    specialty: input.specialty ?? "",
    wallet: input.wallet.toLowerCase(),
    endpoint: input.endpoint,
  });
  return `0x${createHash("sha256").update(canonical).digest("hex")}`;
}

/** One signer = one nonce stream; serialise mints like anchors/payouts. */
let mintQueue: Promise<unknown> = Promise.resolve();
function enqueueMint<T>(task: () => Promise<T>): Promise<T> {
  const run = mintQueue.then(task, task);
  mintQueue = run.catch(() => undefined);
  return run;
}

async function loadContract() {
  const config = agenticIdConfig();
  if (!config.live)
    throw new Error("Agentic ID not configured (need BASE_SIGNER_KEY + AGENTIC_ID_CONTRACT)");
  const { ethers } = await import("ethers");
  const { rpcUrl, privateKey } = baseConfig();
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const base = new ethers.Contract(config.address, CONTRACT_ABI, provider);
  return {
    config,
    signer: new ethers.Wallet(privateKey!, provider),
    read: base as unknown as object &
      AgenticContract & {
        interface: {
          parseLog(o: { topics: string[]; data: string }): { name: string; args: unknown[] } | null;
        };
      },
  };
}

export async function mintAgentIdentity(input: AgentIdentityInput): Promise<MintedIdentity> {
  return enqueueMint(async () => {
    const { config, signer, read } = await loadContract();

    const fee = await read.mintFee();
    const description =
      `Runintel agent ${input.name}` + (input.specialty ? ` · ${input.specialty}` : "");
    const dataHash = agentDataHash(input);

    const writer = read as unknown as {
      connect(signer: unknown): AgenticContract;
    };
    const tx = await writer.connect(signer).iMint(input.wallet, [[description, dataHash]], {
      value: fee,
    });
    const receipt = await tx.wait();

    // Recover the freshly minted tokenId from the ERC-721 Transfer(0x0→owner).
    const { ethers } = await import("ethers");
    let tokenId = "";
    for (const log of receipt.logs) {
      try {
        const parsed = read.interface.parseLog({ topics: [...log.topics], data: log.data });
        if (parsed && parsed.name === "Transfer" && String(parsed.args[0]) === ethers.ZeroAddress) {
          tokenId = String(parsed.args[2]);
          break;
        }
      } catch {
        // not our event
      }
    }
    if (!tokenId) throw new Error("Mint succeeded but tokenId not found in receipt");

    const { baseExplorerTx } = await import("./config");
    return {
      tokenId,
      txHash: receipt.hash,
      dataHash,
      owner: input.wallet,
      explorerUrl: baseExplorerTx(receipt.hash, baseConfig().network),
    };
  });
}

/** Read back the intelligent data of a minted identity (verification path). */
export async function getIdentityDatas(tokenId: string): Promise<IntelligentData[]> {
  const { read } = await loadContract();
  return read.getIntelligentDatas(BigInt(tokenId));
}
