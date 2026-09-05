/** Check the old 0G signer's 0G-chain balances (never prints the key). */
import { readFileSync } from "node:fs";
import { Wallet, JsonRpcProvider, formatEther } from "ethers";

let key: string | undefined;
for (const line of readFileSync("/Users/user/Documents/prime-layer/.env", "utf8").split("\n")) {
  if (line.startsWith("ZERO_G_PRIVATE_KEY")) {
    key = line
      .split("=")[1]
      ?.trim()
      .replace(/^["']|["']$/g, "");
    break;
  }
}
if (!key) process.exit(1);
const w = new Wallet(key);

async function main() {
  for (const [name, rpc] of [
    ["0G mainnet", "https://evmrpc.0g.ai"],
    ["0G testnet", "https://evmrpc-testnet.0g.ai"],
  ] as const) {
    try {
      const p = new JsonRpcProvider(rpc);
      const b = await p.getBalance(w.address);
      console.log(`${name.padEnd(12)} ${formatEther(b)} OG`);
    } catch (e) {
      console.log(`${name.padEnd(12)} error: ${e instanceof Error ? e.message.slice(0, 60) : e}`);
    }
  }
}
main();
