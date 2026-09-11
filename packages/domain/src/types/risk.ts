/**
 * RiskPolicy — every threshold the agent uses, in one configurable object.
 *
 * No magic numbers in the risk engine. Each field here corresponds to a tested
 * branch in `evaluateIntent` and to a row in the specification's deterministic
 * risk table (§7) and CCTP-health policy (§18).
 *
 * v2 (WP-28, D7): this policy no longer prices. The fee a solver charges is its
 * vault's own posted tier (`VaultState.currentFeeBps`), enforced on chain; what
 * remains here is purely the operator's risk appetite — how much, how confirmed,
 * how backed-up the canonical leg may be before this solver stops advancing.
 */

import type { Bps } from './primitives.js';

/** Confirmation requirements scaled by intent size. */
export interface ConfirmationTier {
  /** Applies to intents up to and including this amount. */
  readonly upToAmount: bigint;
  readonly confirmations: number;
}

/**
 * Thresholds governing the response to canonical-settlement conditions
 * (specification §18):
 *
 *   healthy      -> accept normally
 *   slowing      -> reduce the maximum fill (the fee is the vault's, not ours to raise)
 *   large backlog-> reject new fills
 *   unavailable  -> pause new fast fills
 */
export interface SettlementRiskPolicy {
  /** Above this observed mean latency, the transport counts as slowing. */
  readonly slowLatencySeconds: number;
  /** Maximum single fill while slowing. */
  readonly slowMaxFillAmount: bigint;
  /** Aggregate advanced-and-unreimbursed principal above which fills are rejected. */
  readonly backlogRejectValue: bigint;
  /** Oldest unsettled age above which fills are rejected. */
  readonly maxOldestUnsettledAgeSeconds: number;
}

export interface RiskPolicy {
  /** Identifies this policy in every decision record it produces. */
  readonly version: string;
  /** Share of vault capital that may never be advanced. */
  readonly reserveFloorBps: Bps;
  /** Largest single fill, regardless of available liquidity. */
  readonly maxFillAmount: bigint;
  /** Largest aggregate advanced-and-unreimbursed principal. */
  readonly maxOutstandingExposure: bigint;
  /** Ascending by `upToAmount`. */
  readonly confirmationTiers: readonly ConfirmationTier[];
  readonly settlement: SettlementRiskPolicy;
  /** Observations older than this are refused as a basis for risking capital. */
  readonly maxObservationAgeSeconds: number;
}
