/**
 * Virtuals ACP (Agent Commerce Protocol) integration — SDK v2.
 *
 * PrimeBaseLayer participates in the Agent Economy as a buyer:
 *  grid specialists can live in the Virtuals registry. The orchestrator
 *  discovers them with browseAgents() and dispatches inquiry slices as ACP
 *  jobs instead of (or alongside) connector-protocol HTTP commands. Evidence
 *  comes back through the job room.
 *
 * Failure posture mirrors the whole platform: if ACP is not configured
 * (no wallet env) every function here no-ops and the network keeps running
 * on the native connector protocol alone.
 */

import { createWalletClient, http, publicActions, walletActions, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, base } from "viem/chains";
import { ViemProviderAdapter } from "@virtuals-protocol/acp-node-v2";
import type { AcpAgent } from "@virtuals-protocol/acp-node-v2";

/** Which chain ACP jobs run on — Base Sepolia for the build window. */
const DEFAULT_CHAIN_ID = 84532;

export type AcpConfig = {
  live: boolean;
  walletAddress: string;
  chainId: number;
};

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

export function acpChain(): Chain {
  return (readEnv("ACP_CHAIN_ID") ?? String(DEFAULT_CHAIN_ID)) === "8453" ? base : baseSepolia;
}

export function acpConfig(): AcpConfig {
  const pk = readEnv("ACP_PRIVATE_KEY");
  const account = pk ? privateKeyToAccount(pk as `0x${string}`) : null;
  return {
    live: Boolean(account),
    walletAddress: (account?.address ?? readEnv("ACP_WALLET_ADDRESS") ?? "") as `0x${string}`,
    chainId: acpChain().id,
  };
}

/**
 * Build an AcpAgent from env. Shared by the listener script and one-shot
 * helpers so both sides speak to the same registry.
 */
export async function createAcpAgent(): Promise<AcpAgent> {
  const config = acpConfig();
  if (!config.live) throw new Error("ACP not configured (need ACP_PRIVATE_KEY)");
  const chain = acpChain();
  const account = privateKeyToAccount(readEnv("ACP_PRIVATE_KEY")! as `0x${string}`);
  const rpcUrl = readEnv("BASE_RPC_URL") ?? chain.rpcUrls.default.http[0]!;

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  })
    .extend(publicActions)
    .extend(walletActions);

  class LocalViemAdapter extends ViemProviderAdapter {
    constructor() {
      super("prime-base-layer");
    }
    override async getAddress() {
      return account.address;
    }
    override async getSupportedChainIds() {
      return [chain.id];
    }
    // Wallet client (with walletActions) satisfies the IEvmProviderAdapter surface.
    // Signatures use the SDK's own Call type via structural typing on `never`
    // casts — the adapter boundary is trusted here (we control both sides).
    override async sendTransaction(_chainId: number, call: unknown): Promise<`0x${string}`> {
      return walletClient.sendTransaction({ ...(call as object), account, chain } as never);
    }
    override async sendCalls(
      _chainId: number,
      calls: unknown,
    ): Promise<`0x${string}` | `0x${string}`[]> {
      const list = Array.isArray(calls) ? calls : [calls];
      const results: `0x${string}`[] = [];
      for (const call of list) {
        results.push(
          await walletClient.sendTransaction({ ...(call as object), account, chain } as never),
        );
      }
      return results.length === 1 ? results[0]! : results;
    }
    override async getTransactionReceipt(_chainId: number, hash: unknown) {
      const publicClient = walletClient as unknown as {
        getTransactionReceipt: (args: { hash: `0x${string}` }) => Promise<never>;
      };
      return publicClient.getTransactionReceipt({ hash: hash as `0x${string}` });
    }
    override async readContract(_chainId: number, params: unknown) {
      return walletClient.readContract(params as never);
    }
    override async getLogs(_chainId: number, params: unknown) {
      return walletClient.getLogs(params as never);
    }
    override async getBlockNumber(_chainId: number) {
      return walletClient.getBlockNumber();
    }
    override async signMessage(_chainId: number, message: string | Uint8Array) {
      return walletClient.signMessage({
        account,
        message: (typeof message === "string"
          ? message
          : new TextDecoder().decode(message)) as `0x${string}`,
      });
    }
    override async signTypedData(_chainId: number, typedData: unknown) {
      return walletClient.signTypedData({ account, ...(typedData as object) } as never);
    }
  }

  const adapter = new LocalViemAdapter();
  const { AcpAgent: Agent } = await import("@virtuals-protocol/acp-node-v2");
  return Agent.create({ evmProvider: adapter });
}

/** Shape of the requirement payload we send when BUYING intel via ACP jobs. */
export type IntelRequest = {
  type: "intel-request";
  inquiry_id: string;
  question: string;
  scope: { category?: string; geography?: string };
  /** What we need back, mirroring the native connector claim shape. */
  wants: "claims+evidence";
  window_seconds: number;
};

/**
 * Discover specialist agents in the Virtuals registry for an inquiry slice.
 * Returns registry entries (address + name + description).
 */
export async function discoverSpecialists(
  keyword: string,
  topK = 3,
): Promise<{ address: string; name: string; description: string }[]> {
  if (!acpConfig().live) return [];
  try {
    const client = await createAcpAgent();
    const found = await client.browseAgents(keyword, { topK });
    await client.stop();
    return found.map((a) => ({
      address: String(a.walletAddress),
      name: String(a.name),
      description: String(a.description ?? ""),
    }));
  } catch (err) {
    console.error("acp.discoverSpecialists failed:", err);
    return [];
  }
}

/**
 * Create an ACP job that buys intelligence from a registry specialist at
 * `priceUsd`; returns the jobId for tracking. Escrow funding happens through
 * the job session (AssetToken.usdc).
 */
export async function buyIntel(
  providerAddress: string,
  request: IntelRequest,
  priceUsd: number,
  offeringName: string,
): Promise<{ jobId: string } | null> {
  if (!acpConfig().live) return null;
  try {
    const client = await createAcpAgent();
    const jobId = await client.createJobByOfferingName(
      acpChain().id,
      offeringName,
      providerAddress,
      request as unknown as Record<string, unknown>,
    );
    const session = client.getSession(acpChain().id, String(jobId));
    if (session) {
      const { AssetToken } = await import("@virtuals-protocol/acp-node-v2");
      await session.fund(AssetToken.usdc(priceUsd, acpChain().id));
    }
    await client.stop();
    return { jobId: String(jobId) };
  } catch (err) {
    console.error("acp.buyIntel failed:", err);
    return null;
  }
}


