/**
 * The stages telemetry is allowed to report.
 *
 * Deliberately narrow — only the four pre-chain, purely informational stages
 * `WP-INTENT-MARKET.md` §7 names. Anything onchain-confirmed (a fast fill
 * landing, canonical settlement, losing a race) is never reported here; it
 * comes from RPC, a contract read, or the subgraph, and overrides telemetry
 * the instant it exists. `apps/web/src/lib/arcaidia/types.ts`'s `SolverStageId`
 * carries the full state-machine vocabulary (telemetry stages plus onchain
 * ones); this is the telemetry-sourced subset of it, kept independent here
 * because this package has no dependency on the frontend app. If the two ever
 * drift, this one is wrong — the frontend's is the one already relied on.
 */
export type TelemetryStage =
  | 'INTENT_DISCOVERED'
  | 'VERIFYING_SOURCE'
  | 'FORMULATING_FILL'
  | 'SUBMITTING_SETTLEMENT';

export interface TelemetryStageEvent {
  readonly stage: TelemetryStage;
  readonly intentId: `0x${string}`;
  readonly vaultAddress: `0x${string}`;
  /** Unix seconds. */
  readonly at: number;
}

export interface TelemetryHeartbeat {
  readonly vaultAddress: `0x${string}`;
  readonly operatorAddress: `0x${string}`;
  /** Unix seconds. */
  readonly at: number;
}
