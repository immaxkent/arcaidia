import { describe, expect, it } from 'vitest';
import {
  HOOK_LENGTH_BYTES,
  MalformedIntentHookError,
  decodeIntentHook,
  encodeIntentHook,
} from '../src/index.js';
import { BOB } from './fixtures.js';

const INTENT_ID = '0x1234567890123456789012345678901234567890123456789012345678901234' as const;

/** Shared with `contracts/test/IntentHookLib.t.sol`. */
const VECTOR =
  '0x' +
  '0000000000000000000000000000000000000000000000000000000000000001' +
  '1234567890123456789012345678901234567890123456789012345678901234' +
  '0000000000000000000000002222222222222222222222222222222222222222';

describe('intent hook (CCTP hookData, D8)', () => {
  it('encodes to the shared 96-byte vector', () => {
    const encoded = encodeIntentHook({ intentId: INTENT_ID, recipient: BOB });
    expect(encoded).toBe(VECTOR);
    expect((encoded.length - 2) / 2).toBe(HOOK_LENGTH_BYTES);
  });

  it('round-trips', () => {
    expect(decodeIntentHook(encodeIntentHook({ intentId: INTENT_ID, recipient: BOB }))).toEqual({
      intentId: INTENT_ID,
      recipient: BOB,
    });
  });

  it('rejects the wrong length', () => {
    expect(() => decodeIntentHook('0x')).toThrow(MalformedIntentHookError);
    expect(() => decodeIntentHook(`0x${'00'.repeat(95)}`)).toThrow(MalformedIntentHookError);
  });

  it('rejects an unknown version', () => {
    const wrongVersion = `0x${'00'.repeat(31)}02${VECTOR.slice(66)}` as `0x${string}`;
    expect(() => decodeIntentHook(wrongVersion)).toThrow(MalformedIntentHookError);
  });
});
