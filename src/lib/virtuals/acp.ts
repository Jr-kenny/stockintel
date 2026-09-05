/**
 * Virtuals ACP (Agent Commerce Protocol) integration — SDK v2.
 *
 * PrimeBaseLayer participates in the Agent Economy on BOTH sides:
 *
 *  SELL — the orchestrator lists a "demand-readout" offering: other ACP
 *  agents can buy a synthesized demand intelligence readout, paid in USDC
 *  escrowed by ACP on Base. The buyer message is the inquiry; our deliverable
 *  is the readout JSON.
 *
 *  BUY — grid specialists can ALSO live in the Virtuals registry. The
 *  orchestrator discovers them with browseAgents() and dispatches inquiry
 *  slices as ACP jobs instead of (or alongside) connector-protocol HTTP
 *  commands. Evidence comes back through the job room; payment releases
 *  from ACP escrow only when we accept the deliverable.
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

/**
 * The offering we sell on the ACP registry. Judges can find it via agent
 * discovery and buy a real readout — that is Virtuals doing real work.
 */
export const DEMAND_READOUT_OFFERING = {
  name: "prime-base-demand-readout",
  description:
    "B2B demand intelligence readout. Send your supply or question " +
    "(e.g. 'I have 5000 TCL TVs available in Nigeria') and receive a " +
    "synthesized readout: companies showing emerging demand, confidence " +
    "scores, independent source counts, and evidence trails.",
} as const;

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

/** Parse an inbound ACP job's requirement message into an intel request. */
export function parseIntelRequest(raw: string): IntelRequest | null {
  try {
    const parsed = JSON.parse(raw) as Partial<IntelRequest>;
    if (parsed.type !== "intel-request" || !parsed.inquiry_id || !parsed.question) return null;
    return {
      type: "intel-request",
      inquiry_id: parsed.inquiry_id,
      question: parsed.question,
      scope: parsed.scope ?? {},
      wants: "claims+evidence",
      window_seconds: typeof parsed.window_seconds === "number" ? parsed.window_seconds : 300,
    };
  } catch {
    return null;
  }
}

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
): Promise<{ jobId: string } | null> {
  if (!acpConfig().live) return null;
  try {
    const client = await createAcpAgent();
    const jobId = await client.createJobByOfferingName(
      acpChain().id,
      DEMAND_READOUT_OFFERING.name,
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

/**
 * SELL side: handle one inbound ACP entry end-to-end. When a buyer's
 * requirement arrives we run the same orchestrator pipeline as a native
 * inquiry and submit the readout JSON as the deliverable; escrow releases
 * when the buyer completes. Returns true when the entry was handled as an
 * intel request.
 */
export async function handleAcpEntry(session: unknown, entry: unknown): Promise<boolean> {
  const s = session as {
    status?: string;
    sendMessage?: (content: string) => Promise<void>;
    submit?: (deliverable: string) => Promise<void>;
  };
  const e = entry as { kind?: string; contentType?: string; content?: string };

  if (!e || e.kind !== "message" || e.contentType !== "requirement" || s?.status !== "open") {
    return false;
  }
  const req = parseIntelRequest(e.content ?? "");
  if (!req) return false;

  try {
    const { runInquirySync } = await import("@/lib/orchestrator/fns");
    const result = await runInquirySync(req.question);
    await s.submit!(
      JSON.stringify({
        schema: "prime-base.readout/v1",
        inquiry_id: req.inquiry_id,
        ...result,
      }),
    );
    return true;
  } catch (err) {
    console.error("acp.handleAcpEntry failed:", err);
    try {
      await s.sendMessage?.(
        `Intel request failed: ${err instanceof Error ? err.message : "error"} — no charge.`,
      );
    } catch {
      // room may already be closed
    }
    return true; // entry consumed even on failure
  }
}
