/**
 * Vault directory + single-vault current state.
 *
 * WIRE:
 *   V1            -> one Arcaidia House Vault per chain: chainConfig(chainId).houseVault
 *   Intent Market -> additional SolverVaults discovered from Factory/Registry events
 *   Current state -> direct contract reads via solverVaultAbi (liquidity, exposure,
 *                    paused, authorisedSolver, owner)
 *   Aggregates    -> The Graph (fill count, lifetime fees, volume)
 *
 * Fields the deployed contracts do not expose yet must stay `null` so the UI can
 * render `--` instead of a fabricated number.
 */
import { chainConfig } from "@/lib/arcaidia/config";
import { unavailableState, type DataState } from "@/lib/arcaidia/data-state";
import type { Address, OperatorType, VaultStatus } from "@/lib/arcaidia/types";

/** Vault row where every not-yet-readable field is explicitly null. */
export interface VaultDirectoryRow {
  chainId: number;
  vaultAddress: Address;
  operatorLabel: string | null;
  operatorType: OperatorType;
  ownerAddress: Address | null;
  availableLiquidity: bigint | null;
  outstandingExposure: bigint | null;
  utilisationBps: number | null;
  pricingModelId: string | null;
  currentFeeBps: number | null;
  successfulFillCount: number | null;
  lifetimeFees: bigint | null;
  status: VaultStatus | null;
  authorisedSolver: Address | null;
  /** Telemetry pairing only — NOT authorisation. */
  telemetryPaired: boolean | null;
}

export function useVaults(chainId: number): DataState<VaultDirectoryRow[]> {
  const config = chainConfig(chainId);
  if (!config?.houseVault && !config?.vaultFactory) {
    return unavailableState("No vaults deployed on this chain yet");
  }
  // TODO(integration): read house vault + factory/registry events, then contract state.
  return unavailableState("Vault registry not connected");
}

export function useVault(chainId: number, vaultAddress: Address | null): DataState<VaultDirectoryRow> {
  if (!vaultAddress) return unavailableState("Select a vault");
  if (!chainConfig(chainId)?.rpcUrl) return unavailableState("RPC not configured");
  // TODO(integration): direct solverVaultAbi reads for current state.
  return unavailableState("Vault reads not connected");
}

export interface VaultAnalytics {
  /** Historical points derived from indexed events. Never generated. */
  volumeSeries: Array<{ at: number; value: bigint }>;
  feeSeries: Array<{ at: number; value: bigint }>;
  utilisationSeries: Array<{ at: number; bps: number }>;
}

export function useVaultAnalytics(
  chainId: number,
  vaultAddress: Address | null,
): DataState<VaultAnalytics> {
  if (!vaultAddress) return unavailableState("Select a vault");
  if (!chainConfig(chainId)?.subgraphUrl) return unavailableState("Indexer not connected");
  // TODO(integration): aggregate indexed fills into real historical series.
  return unavailableState("Indexer not connected");
}
