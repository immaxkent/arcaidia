/**
 * RiskPolicy — every threshold the agent uses, in one configurable object.
 *
 * No magic numbers in the risk engine. Each field here corresponds to a tested
 * branch in `evaluateIntent` (WP-04) and to a row in the specification's
 * deterministic risk table (§7) and CCTP-health policy (§18).
 */

import type { Bps } from './primitives.js';

/** One step of the utilisation-based fee curve. */
export interface FeeCurvePoint {
  /** Apply this fee at or above this utilisation. */
  readonly atUtilisationBps: Bps;
  readonly feeBps: Bps;
}

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
 *   slowing      -> raise the fee and/or reduce the maximum fill
 *   large backlog-> reject new fills
 *   unavailable  -> pause new fast fills
 */
export interface SettlementRiskPolicy {
  /** Above this observed mean latency, the transport counts as slowing. */
  readonly slowLatencySeconds: number;
  /** Surcharge applied while slowing. */
  readonly slowFeeSurchargeBps: Bps;
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
  /** Fee floor before any utilisation or settlement adjustment. */
  readonly baseFeeBps: Bps;
  /** Protocol fee ceiling. The user's `maxFeeBps` may be lower and always wins. */
  readonly maxFeeBps: Bps;
  /** Ascending by `atUtilisationBps`. */
  readonly utilisationFeeCurve: readonly FeeCurvePoint[];
  /** Ascending by `upToAmount`. */
  readonly confirmationTiers: readonly ConfirmationTier[];
  readonly settlement: SettlementRiskPolicy;
  /** Observations older than this are refused as a basis for risking capital. */
  readonly maxObservationAgeSeconds: number;
}
