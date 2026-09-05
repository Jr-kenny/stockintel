export type ZeroGNetwork = "mainnet" | "testnet";

type NetworkPreset = {
  chainId: number;
  rpcUrl: string;
  indexerRpc: string;
  chainExplorer: string;
  storageExplorer: string;
};

const PRESETS: Record<ZeroGNetwork, NetworkPreset> = {
  mainnet: {
    chainId: 16661,
    rpcUrl: "https://evmrpc.0g.ai",
    indexerRpc: "https://indexer-storage-turbo.0g.ai",
    chainExplorer: "https://chainscan.0g.ai",
    storageExplorer: "https://storagescan.0g.ai",
  },
  testnet: {
    chainId: 16602,
    rpcUrl: "https://evmrpc-testnet.0g.ai",
    indexerRpc: "https://indexer-storage-testnet-turbo.0g.ai",
    chainExplorer: "https://testnet.chainscan.0g.ai",
    storageExplorer: "https://testnet.storagescan.0g.ai",
  },
};

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

export function zeroGConfig() {
  const network = (readEnv("ZERO_G_NETWORK") as ZeroGNetwork | undefined) ?? "testnet";
  const preset = PRESETS[network] ?? PRESETS.testnet;
  const privateKey = readEnv("ZERO_G_PRIVATE_KEY");
  return {
    network,
    ...preset,
    rpcUrl: readEnv("ZERO_G_RPC_URL") ?? preset.rpcUrl,
    indexerRpc: readEnv("ZERO_G_INDEXER_RPC") ?? preset.indexerRpc,
    privateKey,
    /** True only when a funded signer key is present; otherwise anchoring runs in sandbox mode. */
    live: Boolean(privateKey),
  };
}

export function explorerLink(kind: "tx" | "root", value: string, network: ZeroGNetwork) {
  const base = PRESETS[network];
  if (kind === "tx") {
    return network === "mainnet"
      ? `${base.chainExplorer}/tx/${value}`
      : `${base.chainExplorer}/tx/${value}`;
  }
  return `${base.storageExplorer}/file/${value}`;
}
