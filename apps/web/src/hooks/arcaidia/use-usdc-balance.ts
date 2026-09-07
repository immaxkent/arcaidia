/**
 * USDC balance + IntentRouter allowance for the connected owner.
 *
 * SOURCE: viem public client on chainConfig(chainId).rpcUrl
 *   balance   -> erc20Abi.balanceOf(owner) on chainConfig(chainId).usdc
 *   allowance -> erc20Abi.allowance(owner, chainConfig(chainId).intentRouter)
 *
 * Returns `unavailable` while the wallet is disconnected or the chain config
 * lacks a USDC / router address. A real zero balance must render as 0.00.
 */
import { useQuery } from "@tanstack/react-query";
import { erc20Abi } from "@/lib/arcaidia/abis";
import { chainConfig } from "@/lib/arcaidia/config";
import { errorState, readyState, unavailableState, type DataState } from "@/lib/arcaidia/data-state";
import type { Address } from "@/lib/arcaidia/types";
import { publicClientFor } from "@/lib/arcaidia/viem-clients";

const POLL_INTERVAL_MS = 15_000;

export function useUsdcBalance(chainId: number, owner: Address | null): DataState<bigint> {
  const config = chainConfig(chainId);
  const usdc = config?.usdc ?? null;
  const enabled = Boolean(owner && usdc && config?.rpcUrl);

  const query = useQuery({
    queryKey: ["usdc-balance", chainId, usdc, owner],
    queryFn: async () => {
      const client = publicClientFor(chainId);
      if (!client || !usdc || !owner) throw new Error("Balance source not connected");
      return client.readContract({
        address: usdc,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [owner],
      });
    },
    enabled,
    refetchInterval: POLL_INTERVAL_MS,
  });

  if (!owner) return unavailableState("Connect wallet");
  if (!usdc || !config?.rpcUrl) return unavailableState("Token address not configured");
  if (query.isError) return errorState(query.error instanceof Error ? query.error.message : "Read failed");
  if (query.data === undefined) return unavailableState("Balance source not connected");
  return readyState(query.data);
}

export function useUsdcAllowance(chainId: number, owner: Address | null): DataState<bigint> {
  const config = chainConfig(chainId);
  const usdc = config?.usdc ?? null;
  const intentRouter = config?.intentRouter ?? null;
  const enabled = Boolean(owner && usdc && intentRouter && config?.rpcUrl);

  const query = useQuery({
    queryKey: ["usdc-allowance", chainId, usdc, intentRouter, owner],
    queryFn: async () => {
      const client = publicClientFor(chainId);
      if (!client || !usdc || !intentRouter || !owner) throw new Error("Allowance source not connected");
      return client.readContract({
        address: usdc,
        abi: erc20Abi,
        functionName: "allowance",
        args: [owner, intentRouter],
      });
    },
    enabled,
    refetchInterval: POLL_INTERVAL_MS,
  });

  if (!owner) return unavailableState("Connect wallet");
  if (!usdc || !intentRouter || !config?.rpcUrl) return unavailableState("Router address not configured");
  if (query.isError) return errorState(query.error instanceof Error ? query.error.message : "Read failed");
  if (query.data === undefined) return unavailableState("Allowance source not connected");
  return readyState(query.data);
}
