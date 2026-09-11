/**
 * WP-19.3 — merges telemetry's pre-chain stages with the real onchain
 * outcome of the intent telemetry is currently reporting on
 * (`useIntentOutcome`). Onchain always wins the instant it exists;
 * telemetry is only ever a placeholder for the window before it does.
 *
 * Deliberately pure and separate from `SolverOrb`: that component already
 * merges its `onchainStage` prop over telemetry (`onchainStage ??
 * heartbeat-based fallback`) — this function's only job is producing that
 * prop correctly, so the merge logic itself lives in exactly one place.
 */
import type { Address, SolverStageId } from "./types";
import type { DataState } from "./data-state";
import type { IntentOutcome } from "@/hooks/arcaidia/use-intent-outcome";

export function deriveOnchainStage(
  vaultAddress: Address | null,
  outcome: DataState<IntentOutcome>,
): SolverStageId | null {
  if (!vaultAddress) return null;
  if (outcome.status !== "ready") return null;
  if (!outcome.data.filled) return null;

  if (outcome.data.winningVault?.toLowerCase() !== vaultAddress.toLowerCase()) {
    return "LOST_RACE";
  }
  return outcome.data.settled ? "SETTLED" : "AWAITING_CANONICAL_SETTLEMENT";
}
