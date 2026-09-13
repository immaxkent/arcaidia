import { describe, expect, it } from 'vitest';
import { DecisionReason, Verdict, type AgentDecision, type EcosystemIntelligence } from '@arcaidia/domain';
import { applyIntelligence, DEFAULT_INTELLIGENCE_SETTINGS, shouldHold } from '../src/solver/intelligence-policy.js';

/**
 * D13: advisory never changes a decision; selective may only withhold an ACCEPT, and only when
 * the vault is under-priced against the market median *and* liquidity is scarce.
 */

const view = (over: Partial<EcosystemIntelligence> = {}): EcosystemIntelligence => ({
  aggregateAvailableLiquidity: 250_000_000_000n,
  aggregateUtilisationBps: 4_200,
  feeDistribution: { perVault: [], minBps: 5, medianBps: 30, maxBps: 60 },
  outstandingIntentVolume: 0n,
  pendingCctpExposure: 0n,
  recentFillVelocityPerHour: null,
  recentSettlementLatency: { p50Seconds: null, p95Seconds: null, sampleSize: 0 },
  liquidityConcentrationBps: null,
  estimatedOpportunitySize: 0n,
  scarcityScoreBps: 7_500,
  window: { fromSeconds: 0, toSeconds: 3_600 },
  computedAt: 3_600,
  sourceBlocks: {},
  ...over,
});

const accept: AgentDecision = {
  intentId: `0x${'11'.repeat(32)}`,
  verdict: Verdict.ACCEPT,
  reason: DecisionReason.ACCEPTED,
  feeBps: 10,
  feeAmount: 20_000n,
  outputAmount: 19_980_000n,
  inputsUsed: {} as AgentDecision['inputsUsed'],
  policyVersion: 'test',
  decidedAt: 1,
};
const reject: AgentDecision = { ...accept, verdict: Verdict.REJECT, reason: DecisionReason.INSUFFICIENT_LIQUIDITY, feeBps: 0, feeAmount: 0n, outputAmount: 0n };
const selective = { ...DEFAULT_INTELLIGENCE_SETTINGS, mode: 'selective' as const };
const receipt = { network: 'hedera:testnet', transaction: '0.0.1234@1700000000.000000001', payer: '0.0.1234', amount: '1000000', paidAt: 5 };

describe('applyIntelligence — advisory', () => {
  it('only writes the narrative, including the payment receipt when there is one', () => {
    const out = applyIntelligence(accept, view(), receipt, DEFAULT_INTELLIGENCE_SETTINGS);
    expect({ ...out, narrative: undefined }).toEqual({ ...accept, narrative: undefined });
    expect(out.narrative).toBe(
      'ecosystem: liquidity 250000000000, utilisation 4200 bps, scarcity 7500 bps, median fee 30 bps; paid via x402 on hedera:testnet, tx 0.0.1234@1700000000.000000001',
    );
    expect(applyIntelligence(accept, view(), null, DEFAULT_INTELLIGENCE_SETTINGS).narrative).not.toContain('paid');
  });
});

describe('applyIntelligence — selective (D13)', () => {
  it('holds an ACCEPT when under-priced against the median and liquidity is scarce', () => {
    const out = applyIntelligence(accept, view(), receipt, selective);
    expect(out.verdict).toBe(Verdict.REJECT);
    expect(out.reason).toBe(DecisionReason.INTELLIGENCE_HOLD);
    expect(out.feeBps).toBe(0);
    expect(out.feeAmount).toBe(0n);
    expect(out.outputAmount).toBe(0n);
    expect(out.narrative).toContain('selective: HELD — policy said ACCEPT at 10 bps');
  });

  it('does not hold when the fee is within the margin of the median', () => {
    const out = applyIntelligence(accept, view({ feeDistribution: { perVault: [], minBps: 5, medianBps: 14, maxBps: 60 } }), null, selective);
    expect(out.verdict).toBe(Verdict.ACCEPT);
    expect(out.narrative).toContain('no hold (fee 10 bps within 5 bps of median 14 bps)');
  });

  it('does not hold when liquidity is not scarce', () => {
    const out = applyIntelligence(accept, view({ scarcityScoreBps: 2_000 }), null, selective);
    expect(out.verdict).toBe(Verdict.ACCEPT);
    expect(out.narrative).toContain('scarcity 2000 bps below 6000 bps');
  });

  it('does not hold without a market median', () => {
    expect(shouldHold(accept, view({ feeDistribution: { perVault: [], minBps: null, medianBps: null, maxBps: null } }), selective)).toEqual({ hold: false, why: 'no market median' });
  });

  it('never touches a REJECT — the view cannot grant a fill', () => {
    const out = applyIntelligence(reject, view({ feeDistribution: { perVault: [], minBps: 1, medianBps: 1, maxBps: 1 }, scarcityScoreBps: 0 }), null, selective);
    expect({ ...out, narrative: undefined }).toEqual({ ...reject, narrative: undefined });
  });

  it('respects the configured thresholds', () => {
    const strict = { mode: 'selective' as const, holdScarcityBps: 8_000, holdMarginBps: 25 };
    expect(shouldHold(accept, view(), strict).hold).toBe(false);
    expect(shouldHold(accept, view({ scarcityScoreBps: 8_000, feeDistribution: { perVault: [], minBps: 1, medianBps: 40, maxBps: 80 } }), strict).hold).toBe(true);
  });
});
