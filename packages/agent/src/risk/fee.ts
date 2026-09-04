/**
 * Fee pricing.
 *
 * Pure arithmetic over a policy. No I/O, no clock, no randomness: the same
 * inputs must always produce the same quote, because a quote that cannot be
 * reproduced cannot be audited after the fact.
 */

import { BPS_DENOMINATOR, type Bps, type RiskPolicy, type SettlementHealth } from '@arcaidia/domain';

/**
 * Fee for a given vault utilisation, from the policy's curve.
 *
 * The curve is a step function: the applicable point is the highest one whose
 * threshold the utilisation has reached. Below the first point, the base fee
 * applies. Steps rather than interpolation because a step is trivially
 * explainable to an LP and to a judge, and interpolation would invite
 * arguments about the shape rather than the level.
 */
export function utilisationFeeBps(policy: RiskPolicy, utilisation: Bps): Bps {
  let fee = policy.baseFeeBps;

  for (const point of policy.utilisationFeeCurve) {
    if (utilisation >= point.atUtilisationBps && point.feeBps > fee) {
      fee = point.feeBps;
    }
  }

  return fee;
}

/**
 * Whether canonical settlement is slow enough to reprice.
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

/**
 * The fee this intent should carry, before either ceiling is applied.
 *
 * Utilisation sets the base level; a slowing settlement transport adds a
 * surcharge on top, because LP capital is exposed for longer.
 */
export function requiredFeeBps(
  policy: RiskPolicy,
  utilisation: Bps,
  health: SettlementHealth,
): Bps {
  const base = utilisationFeeBps(policy, utilisation);
  const surcharge = isSettlementSlowing(policy, health) ? policy.settlement.slowFeeSurchargeBps : 0;
  return base + surcharge;
}

/** Fee amount in the asset's smallest unit, rounded up in the protocol's favour. */
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
