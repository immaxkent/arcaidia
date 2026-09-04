import { describe, expect, it } from 'vitest';
import { ErrorCode } from '@arcaidia/domain';
import { confirmationsFor, verifySourceTransaction } from '../src/verification/verify-source.js';
import type { SourceEvidence } from '../src/verification/source-evidence.js';
import type { VerificationContext } from '../src/verification/verify-source.js';
import { ARC, NOW, SEPOLIA, USDC, intent } from './fixtures.js';

const ROUTER = '0xRouter00000000000000000000000000000000cd'.toLowerCase() as `0x${string}`;
const ASSET = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';

const baseIntent = intent();

function evidence(overrides: Partial<SourceEvidence> = {}): SourceEvidence {
  return {
    txHash: baseIntent.sourceTxHash,
    status: 'success',
    to: ROUTER,
    blockNumber: 100n,
    currentBlockNumber: 105n,
    intentCreated: {
      intentId: baseIntent.intentId,
      sender: baseIntent.sender,
      recipient: baseIntent.recipient,
      inputToken: baseIntent.inputToken,
      amount: baseIntent.amount,
      sourceChainId: baseIntent.sourceChainId,
      destinationChainId: baseIntent.destinationChainId,
      maxFeeBps: baseIntent.maxFeeBps,
      deadline: baseIntent.deadline,
      nonce: baseIntent.nonce,
      settlementRef: baseIntent.settlementRef,
      emitter: ROUTER,
    },
    ...overrides,
  };
}

function context(overrides: Partial<VerificationContext> = {}): VerificationContext {
  return {
    now: NOW,
    expectedRouter: ROUTER,
    expectedAsset: ASSET,
    supportedDestinationChainIds: [ARC, SEPOLIA],
    alreadyFilled: false,
    ...overrides,
  };
}

const verify = (e = evidence(), c = context(), i = baseIntent) =>
  verifySourceTransaction(i, e, c);

describe('verifySourceTransaction', () => {
  it('accepts a matching, confirmed, committed intent', () => {
    const result = verify();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.confirmations).toBe(6);
  });

  // -----------------------------------------------------------------------
  // Is the transaction real?
  // -----------------------------------------------------------------------

  it('rejects a transaction with no receipt', () => {
    const result = verify(evidence({ status: null }));
    expect(result).toMatchObject({ ok: false, code: ErrorCode.SOURCE_TX_NOT_FOUND });
  });

  it('rejects a reverted transaction', () => {
    expect(verify(evidence({ status: 'reverted' }))).toMatchObject({
      ok: false,
      code: ErrorCode.SOURCE_TX_REVERTED,
    });
  });

  /// Guards against evidence being fetched for the wrong transaction entirely —
  /// a plausible bug in a worker juggling many intents at once.
  it('rejects evidence read for a different transaction', () => {
    expect(verify(evidence({ txHash: '0x'.padEnd(66, '9') as `0x${string}` }))).toMatchObject({
      ok: false,
      code: ErrorCode.INTENT_FIELDS_MISMATCH,
    });
  });

  // -----------------------------------------------------------------------
  // Is it our router?
  // -----------------------------------------------------------------------

  it('rejects a transaction sent to another contract', () => {
    expect(verify(evidence({ to: '0xdeadbeef00000000000000000000000000000001' }))).toMatchObject({
      ok: false,
      code: ErrorCode.SOURCE_ROUTER_MISMATCH,
    });
  });

  it('rejects a receipt with no IntentCreated event', () => {
    expect(verify(evidence({ intentCreated: null }))).toMatchObject({
      ok: false,
      code: ErrorCode.INTENT_EVENT_MISSING,
    });
  });

  /// Anyone can emit an event with our signature. Only ours counts.
  it('rejects an IntentCreated emitted by another contract', () => {
    const impostor = evidence();
    const result = verify(
      evidence({
        intentCreated: {
          ...impostor.intentCreated!,
          emitter: '0xbadc0de000000000000000000000000000000001',
        },
      }),
    );
    expect(result).toMatchObject({ ok: false, code: ErrorCode.SOURCE_ROUTER_MISMATCH });
  });

  it('accepts a router address differing only in case', () => {
    expect(verify(evidence({ to: ROUTER.toUpperCase() as `0x${string}` })).ok).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Does the chain agree with the candidate intent?
  // -----------------------------------------------------------------------

  const fields = [
    ['intentId', { intentId: '0x'.padEnd(66, 'f') as `0x${string}` }],
    ['sender', { sender: '0x9999999999999999999999999999999999999999' as `0x${string}` }],
    ['recipient', { recipient: '0x8888888888888888888888888888888888888888' as `0x${string}` }],
    ['amount', { amount: USDC(999) }],
    ['sourceChainId', { sourceChainId: 1 }],
    ['destinationChainId', { destinationChainId: SEPOLIA }],
    ['maxFeeBps', { maxFeeBps: 999 }],
    ['deadline', { deadline: NOW + 7_200 }],
    ['nonce', { nonce: 99n }],
  ] as const;

  it.each(fields)('rejects when the onchain %s differs', (_name, override) => {
    const base = evidence();
    const result = verify(
      evidence({ intentCreated: { ...base.intentCreated!, ...override } }),
    );
    expect(result).toMatchObject({ ok: false, code: ErrorCode.INTENT_FIELDS_MISMATCH });
  });

  it('names the mismatched field in the detail', () => {
    const base = evidence();
    const result = verify(
      evidence({ intentCreated: { ...base.intentCreated!, amount: USDC(999) } }),
    );
    if (result.ok) throw new Error('expected a rejection');
    expect(result.detail).toContain('amount');
  });

  // -----------------------------------------------------------------------
  // Is it an intent we will act on?
  // -----------------------------------------------------------------------

  it('rejects an unapproved settlement asset', () => {
    const base = evidence();
    const wrongAsset = { ...base.intentCreated!, inputToken: '0xdead000000000000000000000000000000000001' as `0x${string}` };
    const result = verifySourceTransaction(
      { ...baseIntent, inputToken: wrongAsset.inputToken },
      evidence({ intentCreated: wrongAsset }),
      context(),
    );
    expect(result).toMatchObject({ ok: false, code: ErrorCode.ASSET_NOT_ALLOWLISTED });
  });

  it('rejects an unsupported destination chain', () => {
    expect(verify(evidence(), context({ supportedDestinationChainIds: [SEPOLIA] }))).toMatchObject({
      ok: false,
      code: ErrorCode.ROUTE_NOT_SUPPORTED,
    });
  });

  /// The central invariant of the whole design: no fast fill without a
  /// canonical commitment. A zero settlement reference means the funds were
  /// never committed, whatever else the event says.
  it('rejects an intent with no settlement reference', () => {
    const base = evidence();
    const result = verifySourceTransaction(
      { ...baseIntent, settlementRef: `0x${'0'.repeat(64)}` as `0x${string}` },
      evidence({
        intentCreated: { ...base.intentCreated!, settlementRef: `0x${'0'.repeat(64)}` as `0x${string}` },
      }),
      context(),
    );
    expect(result).toMatchObject({ ok: false, code: ErrorCode.SETTLEMENT_NOT_INITIATED });
  });

  // -----------------------------------------------------------------------
  // Is it still actionable?
  // -----------------------------------------------------------------------

  it('rejects an already-filled intent', () => {
    expect(verify(evidence(), context({ alreadyFilled: true }))).toMatchObject({
      ok: false,
      code: ErrorCode.ALREADY_FILLED,
    });
  });

  it('rejects an expired intent', () => {
    expect(verify(evidence(), context({ now: baseIntent.deadline }))).toMatchObject({
      ok: false,
      code: ErrorCode.DEADLINE_IN_PAST,
    });
  });
});

describe('confirmationsFor', () => {
  it('counts the including block as one confirmation', () => {
    expect(confirmationsFor(evidence({ blockNumber: 100n, currentBlockNumber: 100n }))).toBe(1);
  });

  it('counts blocks since inclusion', () => {
    expect(confirmationsFor(evidence({ blockNumber: 100n, currentBlockNumber: 112n }))).toBe(13);
  });

  /// A head behind the transaction's own block means the node is lagging or
  /// inconsistent. Reporting zero makes the caller refuse on the threshold
  /// rather than accidentally passing it with a negative count.
  it('reports zero when the head is behind the transaction', () => {
    expect(confirmationsFor(evidence({ blockNumber: 200n, currentBlockNumber: 100n }))).toBe(0);
  });
});
