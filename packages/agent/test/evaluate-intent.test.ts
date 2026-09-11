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

  it("accepts a healthy intent at the vault's posted tier", () => {
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

  /// D7: the vault is the source of truth for fees. The solver charges exactly the tier the
  /// chain reports — never its own curve, never a markup the vault would reject.
  it("prices at the vault's posted tier, whatever it is", () => {
    const busy = vault({ totalBalance: USDC(45_000), outstandingExposure: USDC(55_000), currentFeeBps: 60 });
    const decision = evaluate(intent(), busy);
    expect(decision.feeBps).toBe(60);
    expect(decision.inputsUsed.vaultFeeBps).toBe(60);
    expect(decision.feeAmount).toBe(USDC(6));
  });

  // -----------------------------------------------------------------------
  // Trade intents (D9): fill only when the destination swap can meet the floor
  // -----------------------------------------------------------------------

  const tradeIntent = () =>
    intent({ tokenOut: '0x3333333333333333333333333333333333333333', targetMinOut: 1n });

  it('declines a trade intent when this solver has no swap adapter', () => {
    const decision = evaluate(tradeIntent(), vault(), health(), context({ tradeSatisfiable: null }));
    expect(decision.verdict).toBe(Verdict.REJECT);
    expect(decision.reason).toBe(DecisionReason.TRADE_NOT_SUPPORTED);
  });

  it('declines a trade intent whose floor the adapter cannot meet', () => {
    const decision = evaluate(tradeIntent(), vault(), health(), context({ tradeSatisfiable: false }));
    expect(decision.reason).toBe(DecisionReason.TRADE_NOT_SUPPORTED);
  });

  it('accepts a trade intent the adapter can satisfy, priced like any other', () => {
    const decision = evaluate(tradeIntent(), vault(), health(), context({ tradeSatisfiable: true }));
    expect(decision.verdict).toBe(Verdict.ACCEPT);
    expect(decision.feeBps).toBe(10);
  });

  it('ignores the trade gate for a plain USDC transfer', () => {
    expect(evaluate(intent(), vault(), health(), context({ tradeSatisfiable: false })).verdict).toBe(
      Verdict.ACCEPT,
    );
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

  /// DEFAULT_RISK_POLICY's own tiers were flattened to 1 confirmation
  /// everywhere, 2026-09-10, for demo speed — this test is about the
  /// INSUFFICIENT_CONFIRMATIONS branch itself, so it supplies a policy with a
  /// real >1 tier rather than relying on today's live default having one.
  const strictConfirmationsPolicy = {
    ...policy,
    confirmationTiers: [
      { upToAmount: USDC(1_000), confirmations: 1 },
      { upToAmount: USDC(10_000), confirmations: 3 },
      { upToAmount: USDC(25_000), confirmations: 6 },
    ],
  };

  it('rejects insufficient confirmations', () => {
    const decision = evaluate(
      intent({ amount: USDC(5_000) }),
      vault(),
      health(),
      context({ sourceConfirmations: 2 }),
      strictConfirmationsPolicy,
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
        strictConfirmationsPolicy,
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

  /// The 2026-09-10 bug: the vault's own live, on-chain `maxFillAmount` is a
  /// separate, independent ceiling from the policy's flat one, sized for
  /// whatever vault actually exists today — not for the policy's assumed
  /// scale. The stricter of the two must govern, or the agent can confidently
  /// quote ACCEPT for a fill the vault itself would revert.
  it("rejects a fill within the policy's ceiling but above the vault's own, stricter cap", () => {
    const small = vault({
      totalBalance: USDC(100),
      reserveFloor: 0n,
      maxFillAmount: USDC(50), // far below the policy's USDC(25_000) ceiling
      maxOutstandingExposure: USDC(80),
    });
    const decision = evaluate(intent({ amount: USDC(100) }), small);
    expect(decision.verdict).toBe(Verdict.REJECT);
    expect(decision.reason).toBe(DecisionReason.INTENT_SIZE_CAP_BREACH);
  });

  it("accepts up to the vault's own cap when it is the stricter one", () => {
    const small = vault({
      totalBalance: USDC(100),
      reserveFloor: 0n,
      maxFillAmount: USDC(50),
      maxOutstandingExposure: USDC(80),
    });
    expect(evaluate(intent({ amount: USDC(50) }), small).verdict).toBe(Verdict.ACCEPT);
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

  /// "Solver ignores intents above the user's acceptable fee": the vault's tier rose past
  /// what this user allowed, so this solver leaves the intent to canonical settlement.
  it("rejects when the vault's posted tier exceeds the user's ceiling", () => {
    const busy = vault({ currentFeeBps: 60 });
    const decision = evaluate(intent({ maxFeeBps: 50 }), busy);
    expect(decision.verdict).toBe(Verdict.REJECT);
    expect(decision.reason).toBe(DecisionReason.FEE_CEILING_EXCEEDED);
    expect(decision.inputsUsed.vaultFeeBps).toBe(60);
    expect(decision.inputsUsed.userMaxFeeBps).toBe(50);
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

  it("rejects when the fill would breach the vault's own exposure cap, even under the policy's own ceiling", () => {
    const small = vault({
      totalBalance: USDC(1_000),
      reserveFloor: 0n,
      maxFillAmount: USDC(1_000),
      maxOutstandingExposure: USDC(500),
      outstandingExposure: USDC(480),
    });
    const decision = evaluate(intent({ amount: USDC(100) }), small);
    expect(decision.verdict).toBe(Verdict.REJECT);
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
          // The price is the vault's, by construction (D7).
          expect(decision.feeBps).toBe(v.currentFeeBps);
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
