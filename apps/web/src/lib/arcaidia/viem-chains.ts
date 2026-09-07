/**
 * viem chain definitions, derived from the shared config rather than duplicated.
 *
 * Arc is not in `viem/chains` — it is defined here per the backend's own
 * verified parameters (`work-packages/OPEN-QUESTIONS.md`, Q8): EVM-compatible,
 * USDC as the native gas token at 18 decimals for gas accounting.
 *
 * Both chains must be registered wherever a wallet is configured with a fixed
 * chain list (Privy's `supportedChains`) — a chain missing from that list
 * throws on send rather than failing softly, so this is the one place both
 * chain definitions live for the whole app to import.
 */
import { defineChain, type Chain } from "viem";
import { sepolia } from "viem/chains";
import { CHAIN_CONFIG } from "./config";
import { ARC_TESTNET, CHAINS, ETHEREUM_SEPOLIA } from "./types";

const arcTestnetRpc = CHAIN_CONFIG[ARC_TESTNET]?.rpcUrl ?? "https://rpc.testnet.arc.io";

export const arcTestnetChain: Chain = defineChain({
  id: ARC_TESTNET,
  name: CHAINS[ARC_TESTNET]?.name ?? "Arc Testnet",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [arcTestnetRpc] } },
  blockExplorers: {
    default: { name: "Arcscan", url: CHAINS[ARC_TESTNET]?.explorer ?? "https://testnet.arcscan.app" },
  },
});

/** `sepolia` from viem/chains, with our configured RPC URL when one is set. */
export const ethereumSepoliaChain: Chain = CHAIN_CONFIG[ETHEREUM_SEPOLIA]?.rpcUrl
  ? { ...sepolia, rpcUrls: { default: { http: [CHAIN_CONFIG[ETHEREUM_SEPOLIA]!.rpcUrl!] } } }
  : sepolia;

/** Both chains, in the fixed order every `supportedChains` list must carry. */
export const SUPPORTED_VIEM_CHAINS: readonly [Chain, Chain] = [
  ethereumSepoliaChain,
  arcTestnetChain,
];

export function viemChainFor(chainId: number): Chain {
  const found = SUPPORTED_VIEM_CHAINS.find((chain) => chain.id === chainId);
  if (!found) throw new Error(`No viem chain definition for chain ${chainId}.`);
  return found;
}
