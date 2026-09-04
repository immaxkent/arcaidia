import { describe, expect, it } from 'vitest';
import { computeIntentId, type IntentParams } from '../src/index.js';
import { baseIntent, mirroredIntent } from './fixtures.js';

describe('computeIntentId', () => {
  it('is deterministic across repeated calls', () => {
    expect(computeIntentId(baseIntent)).toBe(computeIntentId(baseIntent));
  });

  it('produces a 32-byte hex value', () => {
    expect(computeIntentId(baseIntent)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('does not depend on object key order', () => {
    const reordered: IntentParams = {
      nonce: baseIntent.nonce,
      deadline: baseIntent.deadline,
      maxFeeBps: baseIntent.maxFeeBps,
      destinationChainId: baseIntent.destinationChainId,
      sourceChainId: baseIntent.sourceChainId,
      amount: baseIntent.amount,
      inputToken: baseIntent.inputToken,
      recipient: baseIntent.recipient,
      sender: baseIntent.sender,
    };
    expect(computeIntentId(reordered)).toBe(computeIntentId(baseIntent));
  });

  it('distinguishes the two directions of an otherwise identical transfer', () => {
    expect(computeIntentId(mirroredIntent)).not.toBe(computeIntentId(baseIntent));
  });

  const mutations: ReadonlyArray<[string, Partial<IntentParams>]> = [
    ['sender', { sender: '0x9999999999999999999999999999999999999999' }],
    ['recipient', { recipient: '0x8888888888888888888888888888888888888888' }],
    ['inputToken', { inputToken: '0x7777777777777777777777777777777777777777' }],
    ['amount', { amount: 1_000_000_001n }],
    ['sourceChainId', { sourceChainId: 1 }],
    ['destinationChainId', { destinationChainId: 8453 }],
    ['maxFeeBps', { maxFeeBps: 31 }],
    ['deadline', { deadline: 1_800_000_001 }],
    ['nonce', { nonce: 8n }],
  ];

  it.each(mutations)('changes when %s changes', (_field, mutation) => {
    expect(computeIntentId({ ...baseIntent, ...mutation })).not.toBe(computeIntentId(baseIntent));
  });

  it('is stable against a recorded fixture, so a change is never silent', () => {
    // Locks the encoding. If this fails, the Solidity implementation in WP-01
    // and every already-indexed intent id have diverged from this package.
    expect(computeIntentId(baseIntent)).toBe(
      '0xfdff8f70cfc4383e7ce72d188c0ada07df4fefc52fbee57ce54349c621dbb9c8',
    );
  });
});
