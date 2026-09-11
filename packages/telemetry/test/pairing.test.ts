import { describe, expect, it, vi } from 'vitest';
import { PairingError, pairWithRelay } from '../src/pairing.js';

const RELAY_URL = 'https://relay.example';
const CHAIN_ID = 11155111;
const VAULT = '0x1111111111111111111111111111111111111111' as const;
const OPERATOR = '0x2222222222222222222222222222222222222222' as const;
const SIGNATURE = '0xdeadbeef' as const;

function fakeFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  return vi.fn(impl) as unknown as typeof fetch;
}

describe('pairWithRelay', () => {
  it('requests a challenge, signs exactly that challenge, and submits it back', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl = fakeFetch(async (url, init) => {
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      calls.push({ url, body });
      if (url.endsWith('/pair/challenge')) {
        return new Response(JSON.stringify({ challenge: 'nonce-123', expiresAt: 9_999 }), { status: 200 });
      }
      return new Response(null, { status: 200 });
    });

    const signChallenge = vi.fn(async (message: string) => {
      expect(message).toBe('nonce-123');
      return SIGNATURE;
    });

    await pairWithRelay({
      relayUrl: RELAY_URL,
      chainId: CHAIN_ID,
      vaultAddress: VAULT,
      operatorAddress: OPERATOR,
      signChallenge,
      fetchImpl,
    });

    expect(calls[0]?.url).toBe('https://relay.example/v1/telemetry/pair/challenge');
    expect(calls[0]?.body).toMatchObject({ chainId: CHAIN_ID, vaultAddress: VAULT, operatorAddress: OPERATOR });

    expect(calls[1]?.url).toBe('https://relay.example/v1/telemetry/pair');
    expect(calls[1]?.body).toMatchObject({
      chainId: CHAIN_ID,
      vaultAddress: VAULT,
      operatorAddress: OPERATOR,
      challenge: 'nonce-123',
      signature: SIGNATURE,
    });
    expect(signChallenge).toHaveBeenCalledOnce();
  });

  it('strips a trailing slash from the relay URL', async () => {
    const urls: string[] = [];
    const fetchImpl = fakeFetch(async (url) => {
      urls.push(url);
      if (url.endsWith('/pair/challenge')) {
        return new Response(JSON.stringify({ challenge: 'x', expiresAt: 1 }), { status: 200 });
      }
      return new Response(null, { status: 200 });
    });

    await pairWithRelay({
      relayUrl: 'https://relay.example/',
      chainId: CHAIN_ID,
      vaultAddress: VAULT,
      operatorAddress: OPERATOR,
      signChallenge: async () => SIGNATURE,
      fetchImpl,
    });

    expect(urls[0]).toBe('https://relay.example/v1/telemetry/pair/challenge');
  });

  it('throws PairingError, not a generic error, when the challenge request is refused', async () => {
    const fetchImpl = fakeFetch(async () => new Response(null, { status: 503 }));

    await expect(
      pairWithRelay({
        relayUrl: RELAY_URL,
        chainId: CHAIN_ID,
        vaultAddress: VAULT,
        operatorAddress: OPERATOR,
        signChallenge: async () => SIGNATURE,
        fetchImpl,
      }),
    ).rejects.toThrow(PairingError);
  });

  it('throws when the Relay rejects the signed challenge — e.g. the wrong key signed it', async () => {
    const fetchImpl = fakeFetch(async (url) => {
      if (url.endsWith('/pair/challenge')) {
        return new Response(JSON.stringify({ challenge: 'nonce', expiresAt: 1 }), { status: 200 });
      }
      return new Response(null, { status: 401 });
    });

    await expect(
      pairWithRelay({
        relayUrl: RELAY_URL,
        chainId: CHAIN_ID,
        vaultAddress: VAULT,
        operatorAddress: OPERATOR,
        signChallenge: async () => SIGNATURE,
        fetchImpl,
      }),
    ).rejects.toThrow(PairingError);
  });

  it('never calls signChallenge at all when the challenge request itself fails', async () => {
    const fetchImpl = fakeFetch(async () => new Response(null, { status: 500 }));
    const signChallenge = vi.fn(async () => SIGNATURE);

    await expect(
      pairWithRelay({
        relayUrl: RELAY_URL,
        chainId: CHAIN_ID,
        vaultAddress: VAULT,
        operatorAddress: OPERATOR,
        signChallenge,
        fetchImpl,
      }),
    ).rejects.toThrow();

    expect(signChallenge).not.toHaveBeenCalled();
  });
});
