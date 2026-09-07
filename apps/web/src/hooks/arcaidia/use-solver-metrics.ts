/**
 * Solver Console summary metrics and honest solver status.
 *
 * WIRE (all real sources, no estimates):
 *   totalVolumeUsd     -> sum of confirmed WINNING fills (The Graph)
 *   totalFees          -> realised fee events / accounting (The Graph)
 *   transactionCount   -> confirmed winning fill count
 *   averageSettlement  -> canonical settlement timestamp − fast-fill timestamp
 *   availableLiquidity -> direct SolverVault read
 *   outstandingExposure-> direct SolverVault read
 *   utilisationBps     -> direct read / calculation from the two above
 *   status             -> telemetry heartbeat + onchain authorisation state
 *
 * Any field the sources cannot answer stays null so the UI renders `--`.
 */
import { chainConfig } from "@/lib/arcaidia/config";
import { unavailableState, type DataState } from "@/lib/arcaidia/data-state";
import type { Address, SolverAuthState, SolverRuntimeStatus } from "@/lib/arcaidia/types";

export interface SolverMetrics {
  totalVolume: bigint | null;
  totalFees: bigint | null;
  transactionCount: number | null;
  averageSettlementSeconds: number | null;
  availableLiquidity: bigint | null;
  outstandingExposure: bigint | null;
  utilisationBps: number | null;
  authState: SolverAuthState | null;
  runtimeStatus: SolverRuntimeStatus | null;
  authorisedSolver: Address | null;
}

export function useSolverMetrics(
  chainId: number,
  vaultAddress: Address | null,
): DataState<SolverMetrics> {
  if (!vaultAddress) return unavailableState("Deploy vault first");
  if (!chainConfig(chainId)?.rpcUrl) return unavailableState("RPC not configured");
  // TODO(integration): combine SolverVault reads, indexed fills and telemetry heartbeat.
  return unavailableState("Solver metrics not connected");
}
