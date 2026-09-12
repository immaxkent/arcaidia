/**
 * Shared, memoized viem PublicClients — one per chain, reused across every
 * hook that reads on-chain state, rather than a new client per call.
 */
import { createPublicClient, fallback, http, type PublicClient } from "viem";
import { chainConfig } from "./config";
import { ARC_TESTNET, ETHEREUM_SEPOLIA } from "./types";
import { viemChainFor } from "./viem-chains";

/**
 * Public endpoints tried, in order, after the configured one. Circle's rpc.testnet.arc.* began
 * answering Cloudflare 1009 (a geo-block) on 2026-09-12; dRPC and thirdweb serve chain 5042002.
 */
const FALLBACK_RPCS: Record<number, readonly string[]> = {
  [ARC_TESTNET]: ["https://arc-testnet.drpc.org", "https://5042002.rpc.thirdweb.com"],
  [ETHEREUM_SEPOLIA]: ["https://ethereum-sepolia-rpc.publicnode.com"],
};

const clients = new Map<number, PublicClient>();

/** Returns null when the chain has no configured RPC URL yet. */
export function publicClientFor(chainId: number): PublicClient | null {
  const rpcUrl = chainConfig(chainId)?.rpcUrl;
  if (!rpcUrl) return null;
  const cached = clients.get(chainId);
  if (cached) return cached;
  const urls = [rpcUrl, ...(FALLBACK_RPCS[chainId] ?? []).filter((u) => u !== rpcUrl)];
  const client = createPublicClient({
    chain: viemChainFor(chainId),
    transport: fallback(urls.map((u) => http(u, { retryCount: 1 })), { rank: false }),
  });
  clients.set(chainId, client);
  return client;
}
