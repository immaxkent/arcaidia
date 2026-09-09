/**
 * Solver decision feed and network-level activity statistics.
 *
 * SOURCE: a telemetry service (VITE_SOLVER_TELEMETRY_URL) only — the subgraph
 * cannot supply this on its own, and is deliberately not treated as a
 * sufficient source here.
 *
 * `AgentDecision.inputsUsed` carries the risk engine's actual working set for
 * one decision (reserveFloor, sourceConfirmations, observationAgeSeconds, the
 * full settlementHealth snapshot) — none of that is emitted onchain or
 * indexed; it only ever exists in the solver's own decision log
 * (JsonLinesDecisionLog, packages/agent), which is a local file on whichever
 * machine runs the worker, not a networked endpoint. A REJECT or PAUSE
 * verdict never touches the chain at all, so there is no event for an
 * indexer to see regardless. `SolverActivityStats.acceptRateBps` has the same
 * problem one level up: computing it from indexed FastFilled events alone
 * would silently divide by "accepted decisions" instead of "all decisions",
 * since rejections leave no trace to count.
 *
 * V1 runs no telemetry service (see work-packages/WP-INTENT-MARKET.md §7 —
 * `arcaidia-telemetry` is explicitly post-V1), so both hooks below stay
 * `unavailable` until one exists. This is a real, disclosed architecture gap,
 * not an unwired TODO: there being live subgraphs (WP-08/WP-10) does not
 * change it, which is why subgraph availability alone no longer counts as a
 * source for either hook.
 *
 * Returns `empty` only when a connected telemetry source answers with zero rows.
 */
import { SERVICES } from "@/lib/arcaidia/config";
import { unavailableState, type DataState } from "@/lib/arcaidia/data-state";
import type { AgentDecision } from "@/lib/arcaidia/types";

export function useSolverDecisions(chainIds: readonly number[]): DataState<AgentDecision[]> {
  void chainIds;
  if (!SERVICES.solverTelemetryUrl)
    return unavailableState("Decision feed not connected — no telemetry service running");
  // TODO(post-V1): subscribe to the decision feed once arcaidia-telemetry exists.
  return unavailableState("Decision feed not connected");
}

export interface SolverActivityStats {
  decisionCount: number | null;
  acceptRateBps: number | null;
  medianFeeBps: number | null;
  transport: "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | null;
  policyVersion: string | null;
}

export function useSolverActivityStats(
  chainIds: readonly number[],
): DataState<SolverActivityStats> {
  void chainIds;
  if (!SERVICES.solverTelemetryUrl)
    return unavailableState("Solver statistics not connected — no telemetry service running");
  // TODO(post-V1): aggregate from the real decision feed once arcaidia-telemetry exists.
  return unavailableState("Solver statistics not connected");
}
