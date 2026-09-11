import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { buildChallengeMessage, verifyChallengeSignature } from '../src/pairing.js';

const OPERATOR_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const OTHER_KEY = '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba' as const;

const operator = privateKeyToAccount(OPERATOR_KEY);
const other = privateKeyToAccount(OTHER_KEY);

const CHALLENGE_INPUT = {
  chainId: 11155111,
  vaultAddress: '0xc74E693938DfBf7c11b787bA27cddE4c0215AAF1' as const,
  operatorAddress: operator.address,
  nonce: 'fixed-nonce-for-the-test',
  issuedAt: 1_800_000_000,
  expiresAt: 1_800_000_300,
};

describe('buildChallengeMessage', () => {
  it('binds the challenge to chain, vault and operator', () => {
    const message = buildChallengeMessage(CHALLENGE_INPUT);

    expect(message).toContain(`chainId:${CHALLENGE_INPUT.chainId}`);
    expect(message).toContain(CHALLENGE_INPUT.vaultAddress.toLowerCase());
    expect(message).toContain(CHALLENGE_INPUT.operatorAddress.toLowerCase());
    expect(message).toContain(CHALLENGE_INPUT.nonce);
  });

  it('produces a different message for a different vault, all else equal', () => {
    const a = buildChallengeMessage(CHALLENGE_INPUT);
    const b = buildChallengeMessage({
      ...CHALLENGE_INPUT,
      vaultAddress: '0x5555555555555555555555555555555555555555',
    });

    expect(a).not.toBe(b);
  });

  it('produces a different message for a different chain, all else equal', () => {
    const a = buildChallengeMessage(CHALLENGE_INPUT);
    const b = buildChallengeMessage({ ...CHALLENGE_INPUT, chainId: 5042002 });

    expect(a).not.toBe(b);
  });
});

describe('verifyChallengeSignature', () => {
  it('accepts a signature from the claimed operator', async () => {
    const message = buildChallengeMessage(CHALLENGE_INPUT);
    const signature = await operator.signMessage({ message });

    expect(
      await verifyChallengeSignature({ message, signature, expectedAddress: operator.address }),
    ).toBe(true);
  });

  it('rejects a signature from the wrong key', async () => {
    const message = buildChallengeMessage(CHALLENGE_INPUT);
    const signature = await other.signMessage({ message });

    expect(
      await verifyChallengeSignature({ message, signature, expectedAddress: operator.address }),
    ).toBe(false);
  });

  it('rejects a signature over a different message than the one presented', async () => {
    const message = buildChallengeMessage(CHALLENGE_INPUT);
    const signedSomethingElse = await operator.signMessage({ message: 'not the challenge' });

    expect(
      await verifyChallengeSignature({
        message,
        signature: signedSomethingElse,
        expectedAddress: operator.address,
      }),
    ).toBe(false);
  });

  it('rejects a malformed signature without throwing', async () => {
    await expect(
      verifyChallengeSignature({
        message: 'anything',
        signature: '0xnotasignature' as `0x${string}`,
        expectedAddress: operator.address,
      }),
    ).resolves.toBe(false);
  });
});
