import { describe, expect, it } from 'vitest';
import { DEFAULT_RISK_POLICY, requiredConfirmations } from '../src/index.js';
import { USDC } from './fixtures.js';

const policy = DEFAULT_RISK_POLICY;

describe('requiredConfirmations', () => {
  /// DEFAULT_RISK_POLICY's tiers were deliberately flattened to 1 confirmation
  /// across every amount band, 2026-09-10, for demo speed (see
  /// default-policy.ts's own comment) — this exercises the *real* live
  /// policy, so it follows that value rather than asserting the pre-flatten
  /// 1/3/6 escalation, which the "sorts tiers" test below still covers on a
  /// policy it constructs for itself.
  it.each([
    [USDC(1), 1],
    [USDC(1_000), 1],
    [USDC(1_001), 1],
    [USDC(10_000), 1],
    [USDC(10_001), 1],
    [USDC(25_000), 1],
  ])('requires the tier confirmations at %s', (amount, expected) => {
    expect(requiredConfirmations(policy, amount)).toBe(expected);
  });

  /// Above every tier, the strictest requirement applies. Falling through to
  /// zero would mean the largest intents needed the least evidence.
  it('applies the highest requirement above the top tier', () => {
    expect(requiredConfirmations(policy, USDC(10_000_000))).toBe(1);
  });

  it('never decreases as the amount grows', () => {
    let previous = 0;
    for (let whole = 1; whole <= 30_000; whole += 137) {
      const required = requiredConfirmations(policy, USDC(whole));
      expect(required).toBeGreaterThanOrEqual(previous);
      previous = required;
    }
  });

  /// A policy whose tiers are listed out of order must not under-require.
  it('sorts tiers rather than trusting their order', () => {
    const scrambled = {
      ...policy,
      confirmationTiers: [
        { upToAmount: USDC(25_000), confirmations: 6 },
        { upToAmount: USDC(1_000), confirmations: 1 },
        { upToAmount: USDC(10_000), confirmations: 3 },
      ],
    };
    expect(requiredConfirmations(scrambled, USDC(5_000))).toBe(3);
    expect(requiredConfirmations(scrambled, USDC(500))).toBe(1);
  });

  it('requires nothing when no tiers are configured', () => {
    expect(requiredConfirmations({ ...policy, confirmationTiers: [] }, USDC(1_000))).toBe(0);
  });
});
