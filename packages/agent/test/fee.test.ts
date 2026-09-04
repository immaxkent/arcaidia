import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RISK_POLICY,
  effectiveMaxFillAmount,
  feeAmountFor,
  isSettlementSlowing,
  requiredFeeBps,
  utilisationFeeBps,
} from '../src/index.js';
import { USDC, health } from './fixtures.js';

const policy = DEFAULT_RISK_POLICY;

describe('utilisationFeeBps', () => {
  it.each([
    [0, 10],
    [2_499, 10],
    [2_500, 20],
    [4_999, 20],
    [5_000, 35],
    [7_499, 35],
    [7_500, 60],
    [10_000, 60],
  ])('charges %i bps utilisation at %i bps fee', (utilisation, expected) => {
    expect(utilisationFeeBps(policy, utilisation)).toBe(expected);
  });

  it('is monotonic: more utilisation never costs less', () => {
    let previous = 0;
    for (let utilisation = 0; utilisation <= 10_000; utilisation += 97) {
      const fee = utilisationFeeBps(policy, utilisation);
      expect(fee).toBeGreaterThanOrEqual(previous);
      previous = fee;
    }
  });

  it('falls back to the base fee with an empty curve', () => {
    expect(utilisationFeeBps({ ...policy, utilisationFeeCurve: [] }, 9_000)).toBe(policy.baseFeeBps);
  });
});

describe('isSettlementSlowing', () => {
  it('is false while latency is within the threshold', () => {
    expect(isSettlementSlowing(policy, health({ averageSettlementLatencySeconds: 299 }))).toBe(false);
  });

  it('is true past the threshold', () => {
    expect(isSettlementSlowing(policy, health({ averageSettlementLatencySeconds: 301 }))).toBe(true);
  });

  it('is true whenever the transport reports itself degraded', () => {
    expect(
      isSettlementSlowing(policy, health({ transport: 'DEGRADED', averageSettlementLatencySeconds: 5 })),
    ).toBe(true);
  });

  /// Absence of evidence is not evidence of a backlog; the exposure caps still
  /// bound the downside if this call is wrong.
  it('treats no observed latency as not slowing', () => {
    expect(isSettlementSlowing(policy, health({ averageSettlementLatencySeconds: null }))).toBe(false);
  });
});

describe('requiredFeeBps', () => {
  it('adds the surcharge when settlement is slowing', () => {
    const normal = requiredFeeBps(policy, 0, health());
    const slowing = requiredFeeBps(policy, 0, health({ averageSettlementLatencySeconds: 600 }));
    expect(slowing - normal).toBe(policy.settlement.slowFeeSurchargeBps);
  });

  it('compounds utilisation and the settlement surcharge', () => {
    expect(requiredFeeBps(policy, 7_500, health({ transport: 'DEGRADED' }))).toBe(60 + 25);
  });
});

describe('feeAmountFor', () => {
  it('computes whole basis points exactly', () => {
    expect(feeAmountFor(USDC(1_000), 100)).toBe(USDC(10));
  });

  /// Rounds toward the vault: a fee rounded down would let a caller pay less
  /// than the quoted rate on every intent whose amount divides awkwardly.
  it('rounds up when the division is inexact', () => {
    expect(feeAmountFor(1n, 1)).toBe(1n);
    expect(feeAmountFor(12_345n, 37)).toBe(46n);
  });

  it('is zero for a zero fee', () => {
    expect(feeAmountFor(USDC(1_000), 0)).toBe(0n);
  });

  it('never exceeds the amount for a sane fee', () => {
    expect(feeAmountFor(USDC(1_000), 10_000)).toBe(USDC(1_000));
  });
});

describe('effectiveMaxFillAmount', () => {
  it('is the policy maximum while settlement is healthy', () => {
    expect(effectiveMaxFillAmount(policy, health())).toBe(policy.maxFillAmount);
  });

  it('shrinks to the slow maximum when settlement is slowing', () => {
    expect(effectiveMaxFillAmount(policy, health({ transport: 'DEGRADED' }))).toBe(
      policy.settlement.slowMaxFillAmount,
    );
  });

  it('never raises the maximum above the policy ceiling', () => {
    const generous = {
      ...policy,
      settlement: { ...policy.settlement, slowMaxFillAmount: USDC(1_000_000) },
    };
    expect(effectiveMaxFillAmount(generous, health({ transport: 'DEGRADED' }))).toBe(
      policy.maxFillAmount,
    );
  });
});
