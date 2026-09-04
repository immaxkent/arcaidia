import { describe, expect, it } from 'vitest';
import { Verdict } from '@arcaidia/domain';
import {
  DEFAULT_RISK_POLICY,
  InMemoryDecisionLog,
  JsonLinesDecisionLog,
  evaluateIntent,
  formatDecisionSummary,
  serialiseDecision,
} from '../src/index.js';
import { USDC, context, health, intent, vault } from './fixtures.js';

const accepted = evaluateIntent(intent(), vault(), health(), DEFAULT_RISK_POLICY, context());
const refused = evaluateIntent(
  intent(),
  vault({ paused: true }),
  health(),
  DEFAULT_RISK_POLICY,
  context(),
);

describe('serialiseDecision', () => {
  /// bigint does not survive JSON.stringify, and a number would silently lose
  /// precision above 2^53 — only about nine billion units of a six-decimal
  /// asset, which is well inside the range an LP vault can hold.
  it('survives a JSON round trip', () => {
    const record = serialiseDecision(accepted);
    expect(() => JSON.stringify(record)).not.toThrow();
    expect(JSON.parse(JSON.stringify(record))).toEqual(record);
  });

  it('serialises amounts as exact decimal strings', () => {
    const record = serialiseDecision(accepted);
    expect(record.feeAmount).toBe(USDC(1).toString());
    expect(record.outputAmount).toBe(USDC(999).toString());
    expect(record.inputs.requestedAmount).toBe(USDC(1_000).toString());
    expect(record.inputs.availableLiquidity).toBe(USDC(90_000).toString());
  });

  it('keeps precision that a JavaScript number would lose', () => {
    const huge = 9_007_199_254_740_993n; // 2^53 + 1
    const record = serialiseDecision({ ...accepted, feeAmount: huge });

    // The string is exact and converts back to the original bigint.
    expect(record.feeAmount).toBe('9007199254740993');
    expect(BigInt(record.feeAmount)).toBe(huge);

    // Routing the same value through a number does not survive, which is why
    // this field is a string. (A numeric literal of the same digits is already
    // rounded by the parser, so the comparison must go through the string.)
    expect(Number(record.feeAmount).toString()).not.toBe(record.feeAmount);
  });

  /// A record missing an input is a log entry, not an audit trail: the quote
  /// must be recomputable from the record alone.
  it('carries every input the verdict depended on', () => {
    const record = serialiseDecision(accepted);
    expect(record.inputs).toMatchObject({
      requestedAmount: expect.any(String),
      availableLiquidity: expect.any(String),
      reserveFloor: expect.any(String),
      outstandingExposure: expect.any(String),
      utilisationBps: expect.any(Number),
      userMaxFeeBps: expect.any(Number),
      sourceConfirmations: expect.any(Number),
      requiredConfirmations: expect.any(Number),
      observationAgeSeconds: expect.any(Number),
    });
    expect(record.inputs.settlement).toMatchObject({
      transport: 'HEALTHY',
      pendingValue: '0',
      latencySampleSize: 10,
    });
  });

  it('records the policy version, so a quote can be reproduced', () => {
    expect(serialiseDecision(accepted).policyVersion).toBe(DEFAULT_RISK_POLICY.version);
  });

  it('records refusals as fully as acceptances', () => {
    const record = serialiseDecision(refused);
    expect(record.verdict).toBe(Verdict.PAUSE);
    expect(record.reason).toBe('VAULT_PAUSED');
    expect(record.inputs.requestedAmount).toBe(USDC(1_000).toString());
  });

  it('omits the narrative entirely when there is none', () => {
    expect('narrative' in serialiseDecision(accepted)).toBe(false);
  });

  it('carries a narrative when one is present', () => {
    const record = serialiseDecision({ ...accepted, narrative: 'liquidity is ample' });
    expect(record.narrative).toBe('liquidity is ample');
  });
});

describe('formatDecisionSummary', () => {
  it('states the verdict, the reason and the economics', () => {
    const line = formatDecisionSummary(accepted);
    expect(line).toContain('ACCEPT');
    expect(line).toContain('ACCEPTED');
    expect(line).toContain('fee 10bps');
    expect(line).toContain('policy ' + DEFAULT_RISK_POLICY.version);
  });

  /// An operator should not have to open the JSON to see why a fill was refused.
  it('explains a refusal without a quote', () => {
    const line = formatDecisionSummary(refused);
    expect(line).toContain('PAUSE');
    expect(line).toContain('VAULT_PAUSED');
    expect(line).toContain('no quote');
  });

  it('shows the confirmation position', () => {
    expect(formatDecisionSummary(accepted)).toContain('confirmations 10/1');
  });

  it('shows settlement transport health', () => {
    const degraded = evaluateIntent(
      intent(),
      vault(),
      health({ transport: 'DEGRADED' }),
      DEFAULT_RISK_POLICY,
      context(),
    );
    expect(formatDecisionSummary(degraded)).toContain('settlement DEGRADED');
  });

  it('is a single line', () => {
    expect(formatDecisionSummary(accepted)).not.toContain('\n');
  });
});

describe('InMemoryDecisionLog', () => {
  it('collects records in order', () => {
    const log = new InMemoryDecisionLog();
    log.record(accepted);
    log.record(refused);

    expect(log.all()).toHaveLength(2);
    expect(log.all()[0]?.verdict).toBe(Verdict.ACCEPT);
    expect(log.all()[1]?.verdict).toBe(Verdict.PAUSE);
  });

  it('finds every decision taken for one intent', () => {
    const log = new InMemoryDecisionLog();
    log.record(refused);
    log.record(accepted);

    // Both decisions concern the same intent: a refusal then a later accept is
    // the ordinary shape of a retried intent, and both must be retrievable.
    expect(log.forIntent(accepted.intentId)).toHaveLength(2);
    expect(log.forIntent('0x'.padEnd(66, '9'))).toHaveLength(0);
  });

  it('clears', () => {
    const log = new InMemoryDecisionLog();
    log.record(accepted);
    log.clear();
    expect(log.all()).toHaveLength(0);
  });
});

describe('JsonLinesDecisionLog', () => {
  it('writes one parseable JSON object per decision', () => {
    const lines: string[] = [];
    const log = new JsonLinesDecisionLog((line) => lines.push(line));

    log.record(accepted);
    log.record(refused);

    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).not.toContain('\n');
      expect(() => JSON.parse(line)).not.toThrow();
    }
    expect(JSON.parse(lines[0]!).verdict).toBe(Verdict.ACCEPT);
  });
});
