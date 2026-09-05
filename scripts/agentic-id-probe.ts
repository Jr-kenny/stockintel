// One-off probe of the pre-deployed Agentic ID contract on 0G testnet.
import { ethers } from "ethers";

const ADDR =
  process.env.AGENTIC_ID_CONTRACT?.trim() || "0x2700F6A3e505402C9daB154C5c6ab9cAEC98EF1F";
const RPC = process.env.ZERO_G_RPC_URL?.trim() || "https://evmrpc-testnet.0g.ai";

const provider = new ethers.JsonRpcProvider(RPC);
const c = new ethers.Contract(
  ADDR,
  [
    "function mintFee() view returns (uint256)",
    "function totalSupply() view returns (uint256)",
    "function symbol() view returns (string)",
    "function name() view returns (string)",
    "function owner() view returns (address)",
    "function creator() view returns (address)",
    "function balanceOf(address) view returns (uint256)",
    "function paused() view returns (bool)",
    "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
    "function hasRole(bytes32,address) view returns (bool)",
  ],
  provider,
);

console.log("contract:", ADDR);
console.log("chain:", (await provider.getNetwork()).chainId);
for (const [label, fn] of [
  ["name", "name"],
  ["symbol", "symbol"],
  ["mintFee", "mintFee"],
  ["totalSupply", "totalSupply"],
  ["paused", "paused"],
] as const) {
  try {
    console.log(label + ":", String(await c[fn]()));
  } catch (e) {
    console.log(label + ": <no such fn>", e instanceof Error ? e.message.slice(0, 60) : "");
  }
}
