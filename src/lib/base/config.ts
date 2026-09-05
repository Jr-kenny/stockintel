export type BaseNetwork = "mainnet" | "testnet";

type NetworkPreset = {
  chainId: number;
  rpcUrl: string;
  explorer: string;
  /** Native token symbol for logs/UI (ETH on both). */
  nativeSymbol: string;
};

const PRESETS: Record<BaseNetwork, NetworkPreset> = {
  mainnet: {
    chainId: 8453,
    rpcUrl: "https://mainnet.base.org",
    explorer: "https://basescan.org",
    nativeSymbol: "ETH",
  },
  testnet: {
    chainId: 84532,
    rpcUrl: "https://sepolia.base.org",
    explorer: "https://sepolia.basescan.org",
    nativeSymbol: "ETH",
  },
};

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Base chain configuration. Prizes pay in USDC on Base, evidence anchors
 * commit on Base, and agent payouts settle on Base — one signer
 * (BASE_SIGNER_KEY) covers anchoring gas and payroll.
 */
export function baseConfig() {
  const network = (readEnv("BASE_NETWORK") as BaseNetwork | undefined) ?? "testnet";
  const preset = PRESETS[network] ?? PRESETS.testnet;
  const privateKey = readEnv("BASE_SIGNER_KEY");
  let walletAddress: string | undefined;
  if (privateKey) {
    try {
      // Derive the address for logs/UI without importing ethers at module
      // load elsewhere. Sync require is deliberate: baseConfig() is a sync
      // API used on server paths only.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Wallet } = require("ethers") as typeof import("ethers");
      walletAddress = new Wallet(privateKey).address;
    } catch {
      walletAddress = undefined;
    }
  }
  return {
    network,
    ...preset,
    rpcUrl: readEnv("BASE_RPC_URL") ?? preset.rpcUrl,
    privateKey,
    walletAddress,
    /** True only when a funded signer key is present; otherwise anchoring runs in sandbox mode. */
    live: Boolean(privateKey),
  };
}

export function baseExplorerTx(txHash: string, network: BaseNetwork) {
  return `${PRESETS[network].explorer}/tx/${txHash}`;
}
