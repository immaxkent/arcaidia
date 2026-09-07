/**
 * Optional solver telemetry feed (WebSocket / SSE) from the reference runtime
 * (`arcaidia-telemetry` alongside `arcaidia-solver` in the reference Docker
 * Compose stack).
 *
 * WIRE: SERVICES.solverTelemetryUrl.
 *
 * RULES
 *  - Telemetry only ever supplies PRE-CHAIN, informational stages:
 *    INTENT_DISCOVERED / VERIFYING_SOURCE / FORMULATING_FILL / SUBMITTING_SETTLEMENT.
 *  - Onchain-confirmed stages must come from RPC / contract / The Graph and always
 *    override telemetry once a transaction exists.
 *  - Telemetry pairing proves runtime identity. It is NOT solver authorisation.
 *  - With no heartbeat the orb is in standby: "SOLVER OFFLINE" / "AWAITING SOLVER".
 *    Never "SCANNING".
 */
import { SERVICES } from "@/lib/arcaidia/config";
import { unavailableState, type DataState } from "@/lib/arcaidia/data-state";
import type { Address, SolverStageId } from "@/lib/arcaidia/types";

export interface SolverTelemetry {
  /** Last heartbeat, unix seconds. Presence of a heartbeat is what "online" means. */
  lastHeartbeatAt: number;
  /** Operator identity the runtime reports through signed pairing. */
  operatorAddress: Address | null;
  paired: boolean;
  /** Pre-chain stage only; null when the solver is idle. */
  stage: Extract<
    SolverStageId,
    "INTENT_DISCOVERED" | "VERIFYING_SOURCE" | "FORMULATING_FILL" | "SUBMITTING_SETTLEMENT"
  > | null;
  stageAt: number | null;
  intentId: string | null;
}

export function useSolverTelemetry(vaultAddress: Address | null): DataState<SolverTelemetry> {
  if (!vaultAddress) return unavailableState("Deploy vault first");
  if (!SERVICES.solverTelemetryUrl) return unavailableState("Telemetry unavailable");
  // TODO(integration): subscribe to the telemetry WS/SSE feed for this vault.
  return unavailableState("Telemetry unavailable");
}
