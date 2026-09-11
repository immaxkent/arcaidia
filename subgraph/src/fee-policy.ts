import { BigInt } from '@graphprotocol/graph-ts';
import { Vault } from '../generated/schema';

/**
 * The vault's posted fee tier, recomputed from its immutable policy and live
 * utilisation — the same step function as `FeePolicyLib.feeBpsAt` and
 * `packages/domain/src/fee-policy.ts`, so a consumer reading `currentFeeBps`
 * here sees the number the contract itself would return.
 */
export function feeBpsAt(vault: Vault, utilisationBps: i32): i32 {
  if (utilisationBps >= vault.criticalThresholdBps) return vault.criticalFeeBps;
  if (utilisationBps >= vault.highThresholdBps) return vault.highFeeBps;
  if (utilisationBps >= vault.midThresholdBps) return vault.midFeeBps;
  return vault.baseFeeBps;
}

const BPS = BigInt.fromI32(10_000);

/** `ArcaidiaLiquidityVault.utilisationBps()`: exposure over LP-owned total assets. */
export function utilisationOf(vault: Vault): i32 {
  const lpLiquid = vault.liquidBalance.minus(vault.accruedProtocolFees);
  const lpCash = lpLiquid.gt(BigInt.zero()) ? lpLiquid : BigInt.zero();
  const total = lpCash.plus(vault.outstandingExposure);
  if (total.equals(BigInt.zero())) return 10_000;
  return vault.outstandingExposure.times(BPS).div(total).toI32();
}
