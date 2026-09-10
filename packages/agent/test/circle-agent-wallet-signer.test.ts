import { describe, expect, it, vi } from 'vitest';
import { recoverTypedDataAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { fillAuthorizationTypedData, type FillAuthorization } from '@arcaidia/domain';
import {
  CircleAgentWalletSigner,
  CircleSigningError,
  type CircleSigningClient,
} from '../src/signing/circle-agent-wallet-signer.js';
import { ARC, SEPOLIA } from './fixtures.js';

const WALLET_ID = '11111111-1111-1111-1111-111111111111';
const WALLET_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const WALLET_ADDRESS = privateKeyToAccount(WALLET_KEY).address;
const VAULT = '0xAAaA000000000000000000000000000000000001' as const;
const domain = { chainId: ARC, verifyingContract: VAULT } as const;

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

/** Signs with a real local key so the fake "Circle" client returns a real, verifiable signature. */
async function realSignatureFor(auth: FillAuthorization): Promise<`0x${string}`> {
  const account = privateKeyToAccount(WALLET_KEY);
  return account.signTypedData(fillAuthorizationTypedData(auth, domain));
}

function fakeClient(signature: string | undefined): CircleSigningClient {
  return { signTypedData: vi.fn().mockResolvedValue({ data: { signature } }) };
}

describe('CircleAgentWalletSigner', () => {
  it('signs through the injected client and returns the wallet address as signer', async () => {
    const signature = await realSignatureFor(authorization);
    const client = fakeClient(signature);
    const signer = new CircleAgentWalletSigner(client, WALLET_ADDRESS, WALLET_ID);

    const signed = await signer.signFillAuthorization(authorization, domain);

    expect(signed.signature).toBe(signature);
    expect(signed.signer).toBe(WALLET_ADDRESS);
    expect(signed.authorization).toEqual(authorization);
  });

  it('calls the client with the walletId and JSON-encoded typed data (bigints as strings)', async () => {
    const signature = await realSignatureFor(authorization);
    const client = fakeClient(signature);
    const signer = new CircleAgentWalletSigner(client, WALLET_ADDRESS, WALLET_ID);

    await signer.signFillAuthorization(authorization, domain);

    expect(client.signTypedData).toHaveBeenCalledTimes(1);
    const call = vi.mocked(client.signTypedData).mock.calls[0]?.[0];
    expect(call?.walletId).toBe(WALLET_ID);
    const parsed = JSON.parse(call?.data ?? '{}');
    expect(parsed.message.inputAmount).toBe('1000000000');
    expect(parsed.message.nonce).toBe('1');
    expect(() => JSON.parse(call?.data ?? '')).not.toThrow();
  });

  it('produces a signature the vault would recover to the wallet address', async () => {
    const signature = await realSignatureFor(authorization);
    const client = fakeClient(signature);
    const signer = new CircleAgentWalletSigner(client, WALLET_ADDRESS, WALLET_ID);

    const signed = await signer.signFillAuthorization(authorization, domain);

    const recovered = await recoverTypedDataAddress({
      ...fillAuthorizationTypedData(authorization, domain),
      signature: signed.signature,
    });
    expect(recovered).toBe(WALLET_ADDRESS);
  });

  it('rejects when Circle returns no signature', async () => {
    const client = fakeClient(undefined);
    const signer = new CircleAgentWalletSigner(client, WALLET_ADDRESS, WALLET_ID);

    await expect(signer.signFillAuthorization(authorization, domain)).rejects.toThrow(CircleSigningError);
  });

  it('rejects a malformed signature rather than passing it through', async () => {
    const client = fakeClient('not-a-signature');
    const signer = new CircleAgentWalletSigner(client, WALLET_ADDRESS, WALLET_ID);

    await expect(signer.signFillAuthorization(authorization, domain)).rejects.toThrow(CircleSigningError);
  });

  it('rejects a signature missing the trailing recovery byte', async () => {
    const signature = await realSignatureFor(authorization);
    const truncated = signature.slice(0, -2) as `0x${string}`;
    const client = fakeClient(truncated);
    const signer = new CircleAgentWalletSigner(client, WALLET_ADDRESS, WALLET_ID);

    await expect(signer.signFillAuthorization(authorization, domain)).rejects.toThrow(CircleSigningError);
  });

  it('propagates a network/API error from the client rather than swallowing it', async () => {
    const client: CircleSigningClient = {
      signTypedData: vi.fn().mockRejectedValue(new Error('Circle API unreachable')),
    };
    const signer = new CircleAgentWalletSigner(client, WALLET_ADDRESS, WALLET_ID);

    await expect(signer.signFillAuthorization(authorization, domain)).rejects.toThrow(
      'Circle API unreachable',
    );
  });
});
