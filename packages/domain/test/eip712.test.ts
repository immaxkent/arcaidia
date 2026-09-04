import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { recoverTypedDataAddress } from 'viem';
import {
  buildEip712Domain,
  fillAuthorizationTypedData,
  hashFillAuthorization,
  type FillAuthorization,
} from '../src/index.js';
import { ARC, SEPOLIA, VAULT_A, VAULT_B, baseAuthorization } from './fixtures.js';

const account = privateKeyToAccount(
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
);

const arcVault = { chainId: ARC, verifyingContract: VAULT_A } as const;

describe('FillAuthorization EIP-712 schema', () => {
  it('builds a domain naming the destination chain and its vault', () => {
    expect(buildEip712Domain(arcVault)).toEqual({
      name: 'Arcaidia',
      version: '1',
      chainId: ARC,
      verifyingContract: VAULT_A,
    });
  });

  /// Locked against `contracts/test/FillAuthorization.t.sol`, which asserts the
  /// same constant. If the Solidity and TypeScript schemas drift, the agent
  /// signs one thing and the vault verifies another — so a drift in either
  /// language fails both suites rather than surfacing at runtime.
  it('matches the Solidity digest fixture', () => {
    expect(hashFillAuthorization(baseAuthorization, arcVault)).toBe(
      '0xdb3d343722290d7551171c7b8df79f6daa35afe6e0669e186622e2ebb73506bc',
    );
  });

  it('hashes deterministically', () => {
    expect(hashFillAuthorization(baseAuthorization, arcVault)).toBe(
      hashFillAuthorization(baseAuthorization, arcVault),
    );
  });

  it('recovers the signing address from a signature over the typed data', async () => {
    const typedData = fillAuthorizationTypedData(baseAuthorization, arcVault);
    const signature = await account.signTypedData(typedData);
    const recovered = await recoverTypedDataAddress({ ...typedData, signature });
    expect(recovered).toBe(account.address);
  });

  describe('cross-chain replay protection', () => {
    // Arcaidia deploys the same vault bytecode to identical CREATE2 addresses on
    // both chains. Without chainId in the domain, one signature would be valid
    // on both vaults. These two tests are the reason the domain carries both.

    it('produces a different digest for the same vault address on another chain', () => {
      const onArc = hashFillAuthorization(baseAuthorization, { chainId: ARC, verifyingContract: VAULT_A });
      const onSepolia = hashFillAuthorization(baseAuthorization, {
        chainId: SEPOLIA,
        verifyingContract: VAULT_A,
      });
      expect(onArc).not.toBe(onSepolia);
    });

    it('produces a different digest for a different vault on the same chain', () => {
      const vaultA = hashFillAuthorization(baseAuthorization, arcVault);
      const vaultB = hashFillAuthorization(baseAuthorization, { chainId: ARC, verifyingContract: VAULT_B });
      expect(vaultA).not.toBe(vaultB);
    });
  });

  const fields: ReadonlyArray<[string, Partial<FillAuthorization>]> = [
    ['intentId', { intentId: '0x'.padEnd(66, '9') as `0x${string}` }],
    ['sourceChainId', { sourceChainId: ARC }],
    ['sourceTxHash', { sourceTxHash: '0x'.padEnd(66, '1') as `0x${string}` }],
    ['recipient', { recipient: '0x3333333333333333333333333333333333333333' }],
    ['inputAmount', { inputAmount: 1n }],
    ['outputAmount', { outputAmount: 1n }],
    ['feeAmount', { feeAmount: 2n }],
    ['expiry', { expiry: 1_800_000_061 }],
    ['nonce', { nonce: 2n }],
  ];

  it.each(fields)('binds %s into the digest', (_field, mutation) => {
    expect(hashFillAuthorization({ ...baseAuthorization, ...mutation }, arcVault)).not.toBe(
      hashFillAuthorization(baseAuthorization, arcVault),
    );
  });
});
