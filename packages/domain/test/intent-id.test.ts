import { describe, expect, it } from 'vitest';
import { computeIntentId, INTENT_TYPEHASH, isTradeIntent, type IntentParams } from '../src/index.js';
import { baseIntent, maxWidthIntent, mirroredIntent, tradeIntent, VECTORS } from './fixtures.js';

describe('computeIntentId (schema v1.1)', () => {
  it('is deterministic across repeated calls', () => {
    expect(computeIntentId(baseIntent)).toBe(computeIntentId(baseIntent));
  });

  it('produces a 32-byte hex value', () => {
    expect(computeIntentId(baseIntent)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('does not depend on object key order', () => {
    const reordered: IntentParams = {
      targetMinOut: baseIntent.targetMinOut,
      tokenOut: baseIntent.tokenOut,
      nonce: baseIntent.nonce,
      deadline: baseIntent.deadline,
      maxFeeBps: baseIntent.maxFeeBps,
      destinationChainId: baseIntent.destinationChainId,
      sourceChainId: baseIntent.sourceChainId,
      amount: baseIntent.amount,
      inputToken: baseIntent.inputToken,
      recipient: baseIntent.recipient,
      sender: baseIntent.sender,
      intentVersion: baseIntent.intentVersion,
    };
    expect(computeIntentId(reordered)).toBe(computeIntentId(baseIntent));
  });

  it('distinguishes the two directions of an otherwise identical transfer', () => {
    expect(computeIntentId(mirroredIntent)).not.toBe(computeIntentId(baseIntent));
  });

  const mutations: ReadonlyArray<[string, Partial<IntentParams>]> = [
    ['intentVersion', { intentVersion: 2 }],
    ['sender', { sender: '0x9999999999999999999999999999999999999999' }],
    ['recipient', { recipient: '0x8888888888888888888888888888888888888888' }],
    ['inputToken', { inputToken: '0x7777777777777777777777777777777777777777' }],
    ['amount', { amount: 1_000_000_001n }],
    ['sourceChainId', { sourceChainId: 1 }],
    ['destinationChainId', { destinationChainId: 8453 }],
    ['maxFeeBps', { maxFeeBps: 31 }],
    ['deadline', { deadline: 1_800_000_001 }],
    ['nonce', { nonce: 8n }],
    ['tokenOut', { tokenOut: '0x3333333333333333333333333333333333333333', targetMinOut: 1n }],
    ['targetMinOut', { tokenOut: '0x3333333333333333333333333333333333333333', targetMinOut: 2n }],
  ];

  it.each(mutations)('changes when %s changes', (_field, mutation) => {
    expect(computeIntentId({ ...baseIntent, ...mutation })).not.toBe(computeIntentId(baseIntent));
  });

  // The four cross-language vectors. `contracts/test/IntentId.t.sol` asserts the
  // same literals, so a change in either implementation fails both suites.
  it('typehash matches the Solidity constant', () => {
    expect(INTENT_TYPEHASH).toBe(VECTORS.typehash);
  });

  it('vector: USDC-only intent', () => {
    expect(computeIntentId(baseIntent)).toBe(VECTORS.usdcOnly);
  });

  it('vector: trade intent', () => {
    expect(computeIntentId(tradeIntent)).toBe(VECTORS.trade);
  });

  it('vector: mirrored direction', () => {
    expect(computeIntentId(mirroredIntent)).toBe(VECTORS.mirrored);
  });

  it('vector: every width-sensitive field at its maximum', () => {
    expect(computeIntentId(maxWidthIntent)).toBe(VECTORS.maxWidth);
  });

  it('a USDC-only intent and its trade twin are different intents', () => {
    expect(isTradeIntent(baseIntent)).toBe(false);
    expect(isTradeIntent(tradeIntent)).toBe(true);
    expect(computeIntentId(tradeIntent)).not.toBe(computeIntentId(baseIntent));
  });

  it('rejects a deadline the uint64 encoding cannot represent exactly', () => {
    // viem refuses out-of-range numbers rather than silently truncating; the
    // Solidity side would encode a different value, so failing loudly is correct.
    expect(() => computeIntentId({ ...baseIntent, deadline: 2 ** 64 })).toThrow();
  });
});
