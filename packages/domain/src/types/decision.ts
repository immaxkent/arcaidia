/**
 * The agent's decision record.
 *
 * `AgentDecision` is the audit trail for every time LP capital was, or was not,
 * put at risk. It carries the exact inputs behind the quote — a specification
 * requirement (§12) and the substance of the demo's decision panel.
 *
 * The verdict is produced by a pure function over deterministic inputs. An LLM
 * may populate `narrative`; it can never change `verdict`, `feeBps` or any
 * amount.
 */

import type { Bps, Bytes32, UnixSeconds } from './primitives.js';
import type { SettlementHealth } from './settlement.js';

export const Verdict = {
  /** Advance LP capital at the quoted fee. */
  ACCEPT: 'ACCEPT',
  /** Do not fill this intent. Canonical CCTP remains the user's fallback. */
  REJECT: 'REJECT',
  /**
   * Do not fill anything right now — a transport-level condition, not a property
   * of this intent. The settlement agent keeps reconciling while paused.
   */
  PAUSE: 'PAUSE',
} as const;
export type Verdict = (typeof Verdict)[keyof typeof Verdict];

/**
 * Why a decision came out the way it did. Exhaustive and stable: the UI renders
 * these, the tests assert on them, and each maps to one policy rule.
 */
export const DecisionReason = {
  ACCEPTED: 'ACCEPTED',
  INSUFFICIENT_LIQUIDITY: 'INSUFFICIENT_LIQUIDITY',
  RESERVE_FLOOR_BREACH: 'RESERVE_FLOOR_BREACH',
  EXPOSURE_CAP_BREACH: 'EXPOSURE_CAP_BREACH',
  INTENT_SIZE_CAP_BREACH: 'INTENT_SIZE_CAP_BREACH',
  FEE_CEILING_EXCEEDED: 'FEE_CEILING_EXCEEDED',
  DEADLINE_PASSED: 'DEADLINE_PASSED',
  INSUFFICIENT_CONFIRMATIONS: 'INSUFFICIENT_CONFIRMATIONS',
  SETTLEMENT_BACKLOG: 'SETTLEMENT_BACKLOG',
  SETTLEMENT_TRANSPORT_UNAVAILABLE: 'SETTLEMENT_TRANSPORT_UNAVAILABLE',
  VAULT_PAUSED: 'VAULT_PAUSED',
  ROUTE_NOT_SUPPORTED: 'ROUTE_NOT_SUPPORTED',
  ASSET_NOT_SUPPORTED: 'ASSET_NOT_SUPPORTED',
  ALREADY_FILLED: 'ALREADY_FILLED',
  SOURCE_VERIFICATION_FAILED: 'SOURCE_VERIFICATION_FAILED',
  OBSERVATION_STALE: 'OBSERVATION_STALE',
} as const;
export type DecisionReason = (typeof DecisionReason)[keyof typeof DecisionReason];

/**
 * The exact state the decision was taken against. Recorded verbatim so a quote
 * can be reproduced and explained after the fact.
 */
export interface DecisionInputs {
  readonly requestedAmount: bigint;
  readonly availableLiquidity: bigint;
  readonly reserveFloor: bigint;
  readonly outstandingExposure: bigint;
  readonly utilisationBps: Bps;
  readonly userMaxFeeBps: Bps;
  readonly sourceConfirmations: number;
  readonly requiredConfirmations: number;
  readonly settlementHealth: SettlementHealth;
  /** Age of the observation the decision used, for staleness auditing. */
  readonly observationAgeSeconds: number;
}

export interface AgentDecision {
  readonly intentId: Bytes32;
  readonly verdict: Verdict;
  readonly reason: DecisionReason;
  /** Quoted fee. Zero on REJECT/PAUSE. */
  readonly feeBps: Bps;
  readonly feeAmount: bigint;
  /** What the recipient would receive. Zero on REJECT/PAUSE. */
  readonly outputAmount: bigint;
  /** Every input behind the verdict. */
  readonly inputsUsed: DecisionInputs;
  /** Identifies the policy that produced this verdict, for reproducibility. */
  readonly policyVersion: string;
  readonly decidedAt: UnixSeconds;
  /**
   * Optional human-readable explanation. May be LLM-generated. Never load-bearing:
   * removing it changes nothing about the verdict or the numbers.
   */
  readonly narrative?: string;
}
