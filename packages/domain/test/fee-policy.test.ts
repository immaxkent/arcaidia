import { describe, expect, it } from 'vitest';
import {
  InvalidFeePolicyError,
  MAX_FEE_BPS,
  feeBpsAt,
  feePolicyAmountFor,
  validateFeePolicy,
  type FeePolicy,
} from '../src/index.js';
import { baseFeePolicy } from './fixtures.js';

describe('feeBpsAt — shared boundary vectors with FeePolicyLib.t.sol', () => {
  const table: ReadonlyArray<[number, number]> = [
    [0, 10],
    [4_999, 10],
    [5_000, 25],
    [7_499, 25],
    [7_500, 60],
    [8_999, 60],
    [9_000, 120],
    [10_000, 120],
    [12_345, 120],
  ];

  it.each(table)('utilisation %i bps -> fee %i bps', (utilisation, fee) => {
    expect(feeBpsAt(baseFeePolicy, utilisation)).toBe(fee);
  });

  it('is monotonic in utilisation', () => {
    let last = -1;
    for (let u = 0; u <= 10_000; u += 37) {
      const fee = feeBpsAt(baseFeePolicy, u);
      expect(fee).toBeGreaterThanOrEqual(last);
      last = fee;
    }
  });
});

describe('validateFeePolicy — the same rules FeePolicyLib.validate enforces', () => {
  it('accepts the fixture and both extremes', () => {
    expect(() => validateFeePolicy(baseFeePolicy)).not.toThrow();
    expect(() =>
      validateFeePolicy({
        baseFeeBps: 0, midFeeBps: 0, highFeeBps: 0, criticalFeeBps: 0,
        midThresholdBps: 0, highThresholdBps: 1, criticalThresholdBps: 10_000,
      }),
    ).not.toThrow();
    expect(() =>
      validateFeePolicy({
        baseFeeBps: 150, midFeeBps: 150, highFeeBps: 150, criticalFeeBps: 150,
        midThresholdBps: 1, highThresholdBps: 2, criticalThresholdBps: 3,
      }),
    ).not.toThrow();
  });

  const bad: ReadonlyArray<[string, Partial<FeePolicy>]> = [
    ['equal thresholds', { highThresholdBps: 5_000 }],
    ['descending thresholds', { criticalThresholdBps: 7_000 }],
    ['threshold above 100%', { criticalThresholdBps: 10_001 }],
    ['decreasing fees', { highFeeBps: 20 }],
    ['critical fee above the protocol ceiling', { criticalFeeBps: MAX_FEE_BPS + 1 }],
    ['non-integer', { baseFeeBps: 1.5 }],
    ['negative', { baseFeeBps: -1 }],
    ['above uint16', { criticalThresholdBps: 70_000 }],
  ];

  it.each(bad)('rejects %s', (_label, mutation) => {
    expect(() => validateFeePolicy({ ...baseFeePolicy, ...mutation })).toThrow(InvalidFeePolicyError);
  });

  it('pins the protocol ceiling to the market constant', () => {
    expect(MAX_FEE_BPS).toBe(150);
  });
});

describe('feePolicyAmountFor — rounds up in the vault favour, same as Solidity', () => {
  it.each([
    [1_000_000_000n, 30, 3_000_000n],
    [1n, 1, 1n],
    [10_000n, 1, 1n],
    [10_001n, 1, 2n],
    [123_456n, 0, 0n],
  ])('amount %s at %i bps -> %s', (amount, bps, expected) => {
    expect(feePolicyAmountFor(amount, bps)).toBe(expected);
  });
});
