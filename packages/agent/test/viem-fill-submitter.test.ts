import { describe, expect, it } from 'vitest';
import { FillRevertedError, ViemFillSubmitter } from '../src/adapters/viem-fill-submitter.js';
import type { SignedFillAuthorization } from '@arcaidia/domain';
import { intent as makeIntent } from './fixtures.js';

const HASH = `0x${'ab'.repeat(32)}` as const;

function signedAuthorization(): SignedFillAuthorization {
  const i = makeIntent();
  return {
    authorization: {
      intentId: i.intentId,
      sourceChainId: i.sourceChainId,
      sourceTxHash: i.sourceTxHash ?? (`0x${'cd'.repeat(32)}` as const),
      recipient: i.recipient,
      inputAmount: i.amount,
      outputAmount: i.amount - 1_000n,
      feeAmount: 1_000n,
      expiry: i.deadline,
      nonce: 1n,
    },
    signature: `0x${'ef'.repeat(65)}`,
    signer: `0x${'22'.repeat(20)}`,
  } as SignedFillAuthorization;
}

function writer(calls: unknown[]) {
  return {
    writeContract: async (args: unknown) => {
      calls.push(args);
      return HASH;
    },
  };
}

describe('ViemFillSubmitter', () => {
  it('reports the hash only once the receipt says success', async () => {
    const calls: unknown[] = [];
    const waited: string[] = [];
    const submitter = new ViemFillSubmitter(
      new Map([[5_042_002, writer(calls)]]),
      new Map([[5_042_002, { waitForTransactionReceipt: async ({ hash }: { hash: string }) => (waited.push(hash), { status: 'success' as const }) }]]),
    );
    const hash = await submitter.submitFastFill(5_042_002, `0x${'11'.repeat(20)}`, makeIntent(), signedAuthorization());
    expect(hash).toBe(HASH);
    expect(waited).toEqual([HASH]);
    expect(calls).toHaveLength(1);
  });

  it('throws FillRevertedError, carrying the hash, when the mined transaction reverted', async () => {
    const submitter = new ViemFillSubmitter(
      new Map([[5_042_002, writer([])]]),
      new Map([[5_042_002, { waitForTransactionReceipt: async () => ({ status: 'reverted' as const }) }]]),
    );
    await expect(submitter.submitFastFill(5_042_002, `0x${'11'.repeat(20)}`, makeIntent(), signedAuthorization())).rejects.toBeInstanceOf(FillRevertedError);
    await expect(submitter.submitFastFill(5_042_002, `0x${'11'.repeat(20)}`, makeIntent(), signedAuthorization())).rejects.toMatchObject({ txHash: HASH });
  });

  it('without a receipt waiter for the chain, returns the hash as before', async () => {
    const submitter = new ViemFillSubmitter(new Map([[5_042_002, writer([])]]));
    expect(await submitter.submitFastFill(5_042_002, `0x${'11'.repeat(20)}`, makeIntent(), signedAuthorization())).toBe(HASH);
  });
});
