/**
 * USDC balance + IntentRouter allowance for the connected owner.
 *
 * WIRE: viem public client on chainConfig(chainId).rpcUrl
 *   balance   -> erc20Abi.balanceOf(owner) on chainConfig(chainId).usdc
 *   allowance -> erc20Abi.allowance(owner, chainConfig(chainId).intentRouter)
 *
 * Returns `unavailable` while the wallet is disconnected or the chain config
 * lacks a USDC / router address. A real zero balance must render as 0.00.
 */
import { chainConfig } from "@/lib/arcaidia/config";
import { unavailableState, type DataState } from "@/lib/arcaidia/data-state";
import type { Address } from "@/lib/arcaidia/types";

export function useUsdcBalance(chainId: number, owner: Address | null): DataState<bigint> {
  const config = chainConfig(chainId);
  if (!owner) return unavailableState("Connect wallet");
  if (!config?.usdc || !config.rpcUrl) return unavailableState("Token address not configured");
  // TODO(integration): publicClient.readContract({ abi: erc20Abi, functionName: "balanceOf" })
  return unavailableState("Balance source not connected");
}

export function useUsdcAllowance(chainId: number, owner: Address | null): DataState<bigint> {
  const config = chainConfig(chainId);
  if (!owner) return unavailableState("Connect wallet");
  if (!config?.usdc || !config.intentRouter || !config.rpcUrl) {
    return unavailableState("Router address not configured");
  }
  // TODO(integration): publicClient.readContract({ abi: erc20Abi, functionName: "allowance" })
  return unavailableState("Allowance source not connected");
}
