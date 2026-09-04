import { describe, expect, it } from 'vitest';
import { recoverTypedDataAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  fillAuthorizationTypedData,
  hashFillAuthorization,
  type FillAuthorization,
} from '@arcaidia/domain';
import { LocalAgentSigner } from '../src/index.js';
import { ARC, SEPOLIA } from './fixtures.js';

const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const VAULT_A = '0xAAaA000000000000000000000000000000000001' as const;
const VAULT_B = '0xBbbb000000000000000000000000000000000002' as const;

const arcVault = { chainId: ARC, verifyingContract: VAULT_A } as const;

const authorization: FillAuthorization = {
  intentId: '0x1234567890123456789012345678901234567890123456789012345678901234',
  sourceChainId: SEPOLIA,
  sourceTxHash: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
  recipient: '0x2222222222222222222222222222222222222222',
  inputAmount: 1_000_000_000n,
  outputAmount: 999_000_000n,
  feeAmount: 1_000_000n,
  expiry: 1_800_000_060,
  nonce: 1n,
};

const signer = new LocalAgentSigner(KEY);

describe('LocalAgentSigner', () => {
  it('exposes the address the vault must allowlist', () => {
    expect(signer.address).toBe(privateKeyToAccount(KEY).address);
  });

  it('produces a signature that recovers to its own address', async () => {
    const signed = await signer.signFillAuthorization(authorization, arcVault);

    const recovered = await recoverTypedDataAddress({
      ...fillAuthorizationTypedData(authorization, arcVault),
      signature: signed.signature,
    });

    expect(recovered).toBe(signer.address);
    expect(signed.signer).toBe(signer.address);
  });

  it('returns the authorization it signed, unmodified', async () => {
    const signed = await signer.signFillAuthorization(authorization, arcVault);
    expect(signed.authorization).toEqual(authorization);
  });

  it('produces a 65-byte ECDSA signature the vault can ecrecover', async () => {
    const signed = await signer.signFillAuthorization(authorization, arcVault);
    // 0x + 64 r + 64 s + 2 v
    expect(signed.signature).toMatch(/^0x[0-9a-f]{130}$/);
  });

  it('is deterministic for the same authorization and domain', async () => {
    const first = await signer.signFillAuthorization(authorization, arcVault);
    const second = await signer.signFillAuthorization(authorization, arcVault);
    expect(first.signature).toBe(second.signature);
  });

  /// The signer must hash exactly what the vault will hash. A signer that built
  /// its own typed data would be one schema drift away from producing
  /// signatures the vault silently rejects.
  it('signs the digest the shared domain package computes', async () => {
    const signed = await signer.signFillAuthorization(authorization, arcVault);
    const digest = hashFillAuthorization(authorization, arcVault);

    const recovered = await recoverTypedDataAddress({
      ...fillAuthorizationTypedData(authorization, arcVault),
      signature: signed.signature,
    });

    expect(recovered).toBe(signer.address);
    expect(digest).toBe(hashFillAuthorization(authorization, arcVault));
  });

  // ---------------------------------------------------------------------
  // Domain binding
  // ---------------------------------------------------------------------

  /// Both chains run identical vault bytecode at identical CREATE2 addresses,
  /// so only the domain separator stops one signature being spendable twice.
  it('signs differently for the same vault on another chain', async () => {
    const onArc = await signer.signFillAuthorization(authorization, arcVault);
    const onSepolia = await signer.signFillAuthorization(authorization, {
      chainId: SEPOLIA,
      verifyingContract: VAULT_A,
    });

    expect(onArc.signature).not.toBe(onSepolia.signature);
  });

  it('signs differently for another vault on the same chain', async () => {
    const vaultA = await signer.signFillAuthorization(authorization, arcVault);
    const vaultB = await signer.signFillAuthorization(authorization, {
      chainId: ARC,
      verifyingContract: VAULT_B,
    });

    expect(vaultA.signature).not.toBe(vaultB.signature);
  });

  it.each([
    ['intentId', { intentId: '0x'.padEnd(66, '9') as `0x${string}` }],
    ['recipient', { recipient: '0x3333333333333333333333333333333333333333' as `0x${string}` }],
    ['outputAmount', { outputAmount: 1n }],
    ['feeAmount', { feeAmount: 2n }],
    ['expiry', { expiry: 1_800_000_061 }],
    ['nonce', { nonce: 2n }],
  ])('signs differently when %s changes', async (_field, override) => {
    const original = await signer.signFillAuthorization(authorization, arcVault);
    const mutated = await signer.signFillAuthorization(
      { ...authorization, ...override },
      arcVault,
    );

    expect(mutated.signature).not.toBe(original.signature);
  });

  /// Two authorities must be distinguishable by the vault's allowlist.
  it('two signers produce different signatures and addresses', async () => {
    const other = new LocalAgentSigner(
      '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
    );

    expect(other.address).not.toBe(signer.address);
    const a = await signer.signFillAuthorization(authorization, arcVault);
    const b = await other.signFillAuthorization(authorization, arcVault);
    expect(a.signature).not.toBe(b.signature);
  });
});
