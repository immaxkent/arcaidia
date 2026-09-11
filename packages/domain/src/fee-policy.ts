/**
 * Vault fee policy — four utilisation tiers, fixed at vault initialisation
 * (DECISIONS.md D7). Mirrors `contracts/src/libraries/FeePolicyLib.sol` exactly;
 * the two suites share boundary vectors.
 *
 * The vault is the source of truth for fees: it enforces `feeBpsAt` on chain.
 * The solver reads the vault's `currentFeeBps()`; this pure implementation
 * exists so indexers, the frontend and tests can reproduce the same number
 * from a policy plus a utilisation without an RPC.
 */

import { BPS_DENOMINATOR, type Bps } from './types/primitives.js';

export interface FeePolicy {
  /** utilisation <  midThresholdBps */
  readonly baseFeeBps: Bps;
  /** utilisation >= midThresholdBps */
  readonly midFeeBps: Bps;
  /** utilisation >= highThresholdBps */
  readonly highFeeBps: Bps;
  /** utilisation >= criticalThresholdBps */
  readonly criticalFeeBps: Bps;
  readonly midThresholdBps: Bps;
  readonly highThresholdBps: Bps;
  readonly criticalThresholdBps: Bps;
}

/**
 * The protocol-wide worst case a user is guaranteed regardless of which vault
 * wins — `ArcaidiaIntentMarket.MAX_FEE_BPS`. A policy's `criticalFeeBps` may
 * not exceed it, so a vault can never post a price the market would refuse.
 */
export const MAX_FEE_BPS: Bps = 150;

export class InvalidFeePolicyError extends Error {}

/** Throws unless `policy` is well-formed — the same rules `FeePolicyLib.validate` enforces. */
export function validateFeePolicy(policy: FeePolicy): void {
  const { baseFeeBps, midFeeBps, highFeeBps, criticalFeeBps, midThresholdBps, highThresholdBps, criticalThresholdBps } =
    policy;
  const all = [baseFeeBps, midFeeBps, highFeeBps, criticalFeeBps, midThresholdBps, highThresholdBps, criticalThresholdBps];
  if (all.some((v) => !Number.isInteger(v) || v < 0 || v > 65_535)) {
    throw new InvalidFeePolicyError('Every fee policy field must be an integer in [0, 65535] (uint16).');
  }
  if (!(midThresholdBps < highThresholdBps && highThresholdBps < criticalThresholdBps)) {
    throw new InvalidFeePolicyError('Fee policy thresholds must be strictly ascending.');
  }
  if (criticalThresholdBps > BPS_DENOMINATOR) {
    throw new InvalidFeePolicyError(`Fee policy thresholds must be <= ${BPS_DENOMINATOR} bps.`);
  }
  if (!(baseFeeBps <= midFeeBps && midFeeBps <= highFeeBps && highFeeBps <= criticalFeeBps)) {
    throw new InvalidFeePolicyError('Fee policy fees must be non-decreasing across tiers.');
  }
  if (criticalFeeBps > MAX_FEE_BPS) {
    throw new InvalidFeePolicyError(`criticalFeeBps ${criticalFeeBps} exceeds the protocol ceiling of ${MAX_FEE_BPS} bps.`);
  }
}

/** The fee tier that applies at `utilisationBps`. */
export function feeBpsAt(policy: FeePolicy, utilisationBps: number): Bps {
  if (utilisationBps >= policy.criticalThresholdBps) return policy.criticalFeeBps;
  if (utilisationBps >= policy.highThresholdBps) return policy.highFeeBps;
  if (utilisationBps >= policy.midThresholdBps) return policy.midFeeBps;
  return policy.baseFeeBps;
}

/** Fee amount, rounded up in the vault's favour — identical to `FeePolicyLib.feeAmountFor`. */
export function feePolicyAmountFor(inputAmount: bigint, feeBps: Bps): bigint {
  const denominator = BigInt(BPS_DENOMINATOR);
  const numerator = inputAmount * BigInt(feeBps);
  const floor = numerator / denominator;
  return numerator % denominator === 0n ? floor : floor + 1n;
}
