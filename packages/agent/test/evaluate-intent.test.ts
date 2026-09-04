import { describe, expect, it } from 'vitest';
import { DecisionReason, Verdict } from '@arcaidia/domain';
import { DEFAULT_RISK_POLICY, evaluateIntent } from '../src/index.js';
import { NOW, USDC, context, health, intent, vault } from './fixtures.js';

const policy = DEFAULT_RISK_POLICY;

const evaluate = (
  i = intent(),
  v = vault(),
  h = health(),
  c = context(),
  p = policy,
) => evaluateIntent(i, v, h, p, c);

describe('evaluateIntent', () => {
  // -----------------------------------------------------------------------
  // Purity
  // -----------------------------------------------------------------------

  it('returns the same decision for the same inputs', () => {
    expect(evaluate()).toEqual(evaluate());
  });

  it('records the policy version that produced the verdict', () => {
    expect(evaluate().policyVersion).toBe(policy.version);
  });

  /// The decision panel and the audit trail both read these; a quote that
  /// cannot be reproduced from its recorded inputs cannot be explained later.
  it('records every input behind the quote', () => {
    const decision = evaluate();
    expect(decision.inputsUsed).toMatchObject({
      requestedAmount: USDC(1_000),
      availableLiquidity: USDC(90_000),
      reserveFloor: USDC(10_000),
      outstandingExposure: 0n,
      utilisationBps: 0,
      userMaxFeeBps: 100,
      sourceConfirmations: 10,
      requiredConfirmations: 1,
      observationAgeSeconds: 0,
    });
  });

  // -----------------------------------------------------------------------
  // Acceptance
  // -----------------------------------------------------------------------

  it('accepts a healthy intent at the base fee', () => {
    const decision = evaluate();
    expect(decision.verdict).toBe(Verdict.ACCEPT);
    expect(decision.reason).toBe(DecisionReason.ACCEPTED);
    expect(decision.feeBps).toBe(10);
    expect(decision.feeAmount).toBe(USDC(1));
    expect(decision.outputAmount).toBe(USDC(999));
  });

  it('always quotes output plus fee equal to the amount', () => {
    const decision = evaluate();
    expect(decision.outputAmount + decision.feeAmount).toBe(USDC(1_000));
  });

  it('prices higher as utilisation rises', () => {
    const busy = vault({ totalBalance: USDC(45_000), outstandingExposure: USDC(55_000) });
    expect(evaluate(intent(), busy).feeBps).toBeGreaterThan(evaluate().feeBps);
  });

  // -----------------------------------------------------------------------
  // Transport conditions produce PAUSE, not REJECT
  // -----------------------------------------------------------------------

  /// Nothing is wrong with the intent: the system cannot settle right now. The
  /// distinction matters because a paused solver resumes, a rejected intent
  /// does not.
  it('pauses when the settlement transport is unavailable', () => {
    const decision = evaluate(intent(), vault(), health({ transport: 'UNAVAILABLE' }));
    expect(decision.verdict).toBe(Verdict.PAUSE);
    expect(decision.reason).toBe(DecisionReason.SETTLEMENT_TRANSPORT_UNAVAILABLE);
  });

  it('pauses when the vault is paused', () => {
    const decision = evaluate(intent(), vault({ paused: true }));
    expect(decision.verdict).toBe(Verdict.PAUSE);
    expect(decision.reason).toBe(DecisionReason.VAULT_PAUSED);
  });

  it('quotes nothing when it refuses', () => {
    const decision = evaluate(intent(), vault({ paused: true }));
    expect(decision.feeBps).toBe(0);
    expect(decision.feeAmount).toBe(0n);
    expect(decision.outputAmount).toBe(0n);
  });

  // -----------------------------------------------------------------------
  // Backlog
  // -----------------------------------------------------------------------

  it('rejects once pending value exceeds the backlog limit', () => {
    const decision = evaluate(intent(), vault(), health({ pendingValue: USDC(46_000) }));
    expect(decision.verdict).toBe(Verdict.REJECT);
    expect(decision.reason).toBe(DecisionReason.SETTLEMENT_BACKLOG);
  });

  it('accepts at exactly the backlog limit', () => {
    expect(evaluate(intent(), vault(), health({ pendingValue: USDC(45_000) })).verdict).toBe(
      Verdict.ACCEPT,
    );
  });

  it('rejects once the oldest unsettled advance is too old', () => {
    const decision = evaluate(intent(), vault(), health({ oldestUnsettledAgeSeconds: 1_201 }));
    expect(decision.reason).toBe(DecisionReason.SETTLEMENT_BACKLOG);
  });

  it('accepts at exactly the oldest-unsettled limit', () => {
    expect(
      evaluate(intent(), vault(), health({ oldestUnsettledAgeSeconds: 1_200 })).verdict,
    ).toBe(Verdict.ACCEPT);
  });

  // -----------------------------------------------------------------------
  // Evidence quality
  // -----------------------------------------------------------------------

  it('rejects a stale observation', () => {
    const decision = evaluate(intent(), vault({ observedAt: NOW - 61 }));
    expect(decision.reason).toBe(DecisionReason.OBSERVATION_STALE);
  });

  it('accepts an observation at exactly the age limit', () => {
    expect(evaluate(intent(), vault({ observedAt: NOW - 60 })).verdict).toBe(Verdict.ACCEPT);
  });

  it('rejects an intent that is already filled', () => {
    const decision = evaluate(intent(), vault(), health(), context({ alreadyFilled: true }));
    expect(decision.reason).toBe(DecisionReason.ALREADY_FILLED);
  });

  it('rejects an expired intent', () => {
    const decision = evaluate(intent({ deadline: NOW }));
    expect(decision.reason).toBe(DecisionReason.DEADLINE_PASSED);
  });

  it('rejects insufficient confirmations', () => {
    const decision = evaluate(
      intent({ amount: USDC(5_000) }),
      vault(),
      health(),
      context({ sourceConfirmations: 2 }),
    );
    expect(decision.reason).toBe(DecisionReason.INSUFFICIENT_CONFIRMATIONS);
    expect(decision.inputsUsed.requiredConfirmations).toBe(3);
  });

  it('accepts at exactly the required confirmations', () => {
    expect(
      evaluate(
        intent({ amount: USDC(5_000) }),
        vault(),
        health(),
        context({ sourceConfirmations: 3 }),
      ).verdict,
    ).toBe(Verdict.ACCEPT);
  });

  // -----------------------------------------------------------------------
  // Size, price and capital
  // -----------------------------------------------------------------------

  it('rejects an intent above the size cap', () => {
    const decision = evaluate(intent({ amount: USDC(25_001) }), vault(), health(), context());
    expect(decision.reason).toBe(DecisionReason.INTENT_SIZE_CAP_BREACH);
  });

  /// A slowing transport shrinks the maximum fill as well as raising the fee.
  it('rejects a large intent when settlement is slowing, that it would otherwise accept', () => {
    const large = intent({ amount: USDC(20_000) });
    expect(evaluate(large).verdict).toBe(Verdict.ACCEPT);

    const slowing = evaluate(large, vault(), health({ transport: 'DEGRADED' }));
    expect(slowing.verdict).toBe(Verdict.REJECT);
    expect(slowing.reason).toBe(DecisionReason.INTENT_SIZE_CAP_BREACH);
  });

  /// Rejected, never clamped: silently charging less would hide a mispriced risk.
  it("rejects when the risk-priced fee exceeds the user's ceiling", () => {
    const decision = evaluate(intent({ maxFeeBps: 5 }));
    expect(decision.verdict).toBe(Verdict.REJECT);
    expect(decision.reason).toBe(DecisionReason.FEE_CEILING_EXCEEDED);
    expect(decision.feeBps).toBe(0);
  });

  it('accepts when the user ceiling exactly matches the quote', () => {
    expect(evaluate(intent({ maxFeeBps: 10 })).verdict).toBe(Verdict.ACCEPT);
  });

  it('rejects when the risk-priced fee exceeds the protocol ceiling', () => {
    const expensive = { ...policy, baseFeeBps: 150 };
    const decision = evaluate(intent(), vault(), health(), context(), expensive);
    expect(decision.reason).toBe(DecisionReason.FEE_EXCEEDS_PROTOCOL_CEILING);
  });

  it('rejects when liquidity cannot cover the output', () => {
    const thin = vault({ totalBalance: USDC(10_500), reserveFloor: USDC(10_000) });
    const decision = evaluate(intent({ amount: USDC(1_000) }), thin);
    expect(decision.reason).toBe(DecisionReason.INSUFFICIENT_LIQUIDITY);
  });

  it('rejects when the fill would breach the exposure cap', () => {
    const exposed = vault({ outstandingExposure: USDC(59_500) });
    const decision = evaluate(intent({ amount: USDC(1_000) }), exposed);
    expect(decision.reason).toBe(DecisionReason.EXPOSURE_CAP_BREACH);
  });

  // -----------------------------------------------------------------------
  // Properties
  // -----------------------------------------------------------------------

  it('never quotes above the user ceiling on any accepted intent', () => {
    for (let whole = 1; whole <= 25_000; whole += 313) {
      for (const utilisation of [0, 3_000, 6_000, 8_000]) {
        const v = vault({
          totalBalance: USDC(100_000),
          outstandingExposure: (USDC(100_000) * BigInt(utilisation)) / BigInt(10_000 - utilisation || 1),
        });
        const decision = evaluate(intent({ amount: USDC(whole) }), v);
        if (decision.verdict === Verdict.ACCEPT) {
          expect(decision.feeBps).toBeLessThanOrEqual(intent().maxFeeBps);
          expect(decision.feeBps).toBeLessThanOrEqual(policy.maxFeeBps);
        }
      }
    }
  });

  it('never accepts a fill that breaches the reserve floor or the exposure cap', () => {
    for (let whole = 1; whole <= 30_000; whole += 271) {
      for (const exposedWhole of [0, 20_000, 50_000, 59_000]) {
        const v = vault({ outstandingExposure: USDC(exposedWhole) });
        const decision = evaluate(intent({ amount: USDC(whole) }), v);
        if (decision.verdict === Verdict.ACCEPT) {
          expect(decision.outputAmount).toBeLessThanOrEqual(USDC(90_000));
          expect(v.outstandingExposure + decision.outputAmount).toBeLessThanOrEqual(
            policy.maxOutstandingExposure,
          );
        }
      }
    }
  });

  /// The LLM narration hook must be incapable of changing anything.
  it('produces no narrative of its own', () => {
    expect(evaluate().narrative).toBeUndefined();
  });
});
