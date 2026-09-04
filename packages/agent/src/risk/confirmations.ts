/**
 * Confirmation policy.
 *
 * Larger intents wait for more source confirmations before LP capital is
 * advanced, because a source reorg after a fast fill is an unrecoverable loss:
 * the recipient has the money and the canonical leg never arrives.
 */

import type { ConfirmationTier, RiskPolicy } from '@arcaidia/domain';

/**
 * Confirmations required for an amount.
 *
 * Tiers are read as "up to and including this amount"; the first matching tier
 * wins, and anything above every tier takes the highest requirement. Sorting is
 * done here rather than trusted to the policy author, so a mis-ordered policy
 * cannot silently under-require confirmations.
 */
export function requiredConfirmations(policy: RiskPolicy, amount: bigint): number {
  const tiers = [...policy.confirmationTiers].sort((a, b) =>
    a.upToAmount < b.upToAmount ? -1 : a.upToAmount > b.upToAmount ? 1 : 0,
  );

  if (tiers.length === 0) return 0;

  for (const tier of tiers) {
    if (amount <= tier.upToAmount) return tier.confirmations;
  }

  return highestRequirement(tiers);
}

function highestRequirement(tiers: readonly ConfirmationTier[]): number {
  return tiers.reduce((max, tier) => (tier.confirmations > max ? tier.confirmations : max), 0);
}
