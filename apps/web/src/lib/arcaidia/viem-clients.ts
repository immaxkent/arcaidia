/**
 * Shared, memoized viem PublicClients — one per chain, reused across every
 * hook that reads on-chain state, rather than a new client per call.
 */
import { createPublicClient, http, type PublicClient } from "viem";
import { chainConfig } from "./config";
import { viemChainFor } from "./viem-chains";

const clients = new Map<number, PublicClient>();

/** Returns null when the chain has no configured RPC URL yet. */
export function publicClientFor(chainId: number): PublicClient | null {
  const rpcUrl = chainConfig(chainId)?.rpcUrl;
  if (!rpcUrl) return null;
  const cached = clients.get(chainId);
  if (cached) return cached;
  const client = createPublicClient({ chain: viemChainFor(chainId), transport: http(rpcUrl) });
  clients.set(chainId, client);
  return client;
}
