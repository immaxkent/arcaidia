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

/**
 * The runtime form of `TelemetryStage`, for a boundary that has to validate
 * an arbitrary string against it -- the Relay's `POST /v1/telemetry/events`
 * (WP-18.3), which must reject anything claiming an onchain-confirmed stage
 * over this channel. Kept here, next to the type it enumerates, so the two
 * cannot drift apart from each other the way the type could from the
 * frontend's own vocabulary (see above).
 */
export const TELEMETRY_STAGES: readonly TelemetryStage[] = [
  'INTENT_DISCOVERED',
  'VERIFYING_SOURCE',
  'FORMULATING_FILL',
  'SUBMITTING_SETTLEMENT',
];

export interface TelemetryStageEvent {
  /**
   * Which vault this concerns. Required, not implied by `vaultAddress` alone:
   * Arcaidia deploys through CREATE2 with identical salts, so the same vault
   * address is expected to recur on every chain the protocol is live on (the
   * House Vault already does, today) — a Relay keyed on address alone would
   * silently merge two different vaults' telemetry the moment that happens.
   */
  readonly chainId: number;
  readonly stage: TelemetryStage;
  readonly intentId: `0x${string}`;
  readonly vaultAddress: `0x${string}`;
  /** Unix seconds. */
  readonly at: number;
}

export interface TelemetryHeartbeat {
  /** See `TelemetryStageEvent.chainId` — same reason, same requirement. */
  readonly chainId: number;
  readonly vaultAddress: `0x${string}`;
  readonly operatorAddress: `0x${string}`;
  /** Unix seconds. */
  readonly at: number;
}
