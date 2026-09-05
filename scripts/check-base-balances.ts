/**
 /** Check a signer's balances on Base + 0G chains (never prints the key).
  * bun scripts/check-base-balances.ts [path-to-env] [key-var-name]
  */
import { readFileSync } from "node:fs";
import { Wallet, JsonRpcProvider, Contract, formatEther, formatUnits } from "ethers";

const envPath = process.argv[2] ?? "/Users/user/Documents/primebaselayer/.env";
const keyVar = process.argv[3] ?? "BASE_SIGNER_KEY";
let key: string | undefined;
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  if (line.startsWith(keyVar)) {
    key = line
      .split("=")[1]
      ?.trim()
      .replace(/^["']|["']$/g, "");
    break;
  }
}
if (!key) {
  console.error("no ZERO_G_PRIVATE_KEY in", envPath);
  process.exit(1);
}

const wallet = new Wallet(key);
console.log("signer address:", wallet.address);

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const erc20 = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

async function check(name: string, rpc: string) {
  try {
    const p = new JsonRpcProvider(rpc);
    const eth = await p.getBalance(wallet.address);
    let usdc = "";
    if (name !== "0G") {
      try {
        const c = new Contract(USDC, erc20, p);
        const [raw, dec] = await Promise.all([c.balanceOf(wallet.address), c.decimals()]);
        usdc = ` | USDC ${formatUnits(raw, dec)}`;
      } catch {
        usdc = " | USDC n/a (no contract on this net)";
      }
    }
    console.log(`${name.padEnd(14)} ${formatEther(eth)} ETH${usdc}`);
  } catch (e) {
    console.log(`${name.padEnd(14)} error: ${e instanceof Error ? e.message.slice(0, 80) : e}`);
  }
}

await check("Base Sepolia", "https://sepolia.base.org");
await check("Base mainnet", "https://mainnet.base.org");
