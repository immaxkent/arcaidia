/**
 * Fee arithmetic and settlement-condition adjustments.
 *
 * Pure: no I/O, no clock, no randomness — the same inputs must always produce
 * the same numbers, because a quote that cannot be reproduced cannot be audited.
 *
 * v2 (WP-28, D7): the *price* is no longer computed here. A solver charges its
 * vault's posted tier — `VaultState.currentFeeBps`, read from the chain — and
 * the vault rejects anything above it. What remains here is the rounding rule
 * for a fee amount (identical to `FeePolicyLib.feeAmountFor`) and the one
 * settlement-driven adjustment the solver still owns: shrinking its maximum
 * fill while the canonical leg is slow.
 */

import { BPS_DENOMINATOR, type Bps, type RiskPolicy, type SettlementHealth } from '@arcaidia/domain';

/**
 * Whether canonical settlement is slow enough to tighten up.
 *
 * `null` latency means no completed settlements have been observed yet, which
 * is treated as "not slowing" rather than as slow: absence of evidence is not
 * evidence of a backlog, and the exposure caps still bound the downside.
 */
export function isSettlementSlowing(policy: RiskPolicy, health: SettlementHealth): boolean {
  if (health.transport === 'DEGRADED') return true;
  if (health.averageSettlementLatencySeconds === null) return false;
  return health.averageSettlementLatencySeconds > policy.settlement.slowLatencySeconds;
}

/** Fee amount in the asset's smallest unit, rounded up in the vault's favour — same as `FeePolicyLib`. */
export function feeAmountFor(amount: bigint, feeBps: Bps): bigint {
  const denominator = BigInt(BPS_DENOMINATOR);
  const numerator = amount * BigInt(feeBps);
  const floor = numerator / denominator;
  return numerator % denominator === 0n ? floor : floor + 1n;
}

/** The largest fill permitted right now, given settlement conditions. */
export function effectiveMaxFillAmount(policy: RiskPolicy, health: SettlementHealth): bigint {
  if (!isSettlementSlowing(policy, health)) return policy.maxFillAmount;
  const slow = policy.settlement.slowMaxFillAmount;
  return slow < policy.maxFillAmount ? slow : policy.maxFillAmount;
}
