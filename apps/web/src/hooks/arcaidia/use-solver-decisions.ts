/**
 * Solver decision feed and network-level activity statistics.
 *
 * WIRE:
 *   decisions -> published solver decision feed (telemetry) and/or indexed
 *                IntentCreated + fill outcomes. Each row must carry the real
 *                inputs the policy used; never reconstruct them.
 *   stats     -> aggregates computed from those real rows only.
 *
 * Returns `empty` only when a connected source answers with zero rows.
 */
import { chainConfig } from "@/lib/arcaidia/config";
import { SERVICES } from "@/lib/arcaidia/config";
import { unavailableState, type DataState } from "@/lib/arcaidia/data-state";
import type { AgentDecision } from "@/lib/arcaidia/types";

export function useSolverDecisions(chainIds: readonly number[]): DataState<AgentDecision[]> {
  const hasSource = SERVICES.solverTelemetryUrl || chainIds.some((id) => chainConfig(id)?.subgraphUrl);
  if (!hasSource) return unavailableState("Decision feed not connected");
  // TODO(integration): subscribe to the decision feed / query indexed outcomes.
  return unavailableState("Decision feed not connected");
}

export interface SolverActivityStats {
  decisionCount: number | null;
  acceptRateBps: number | null;
  medianFeeBps: number | null;
  transport: "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | null;
  policyVersion: string | null;
}

export function useSolverActivityStats(chainIds: readonly number[]): DataState<SolverActivityStats> {
  const hasSource = SERVICES.solverTelemetryUrl || chainIds.some((id) => chainConfig(id)?.subgraphUrl);
  if (!hasSource) return unavailableState("Solver statistics not connected");
  // TODO(integration): aggregate from the real decision feed.
  return unavailableState("Solver statistics not connected");
}
