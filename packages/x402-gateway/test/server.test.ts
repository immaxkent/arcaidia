import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodePaymentSignatureHeader, decodePaymentRequiredHeader, decodePaymentResponseHeader } from '@x402/core/http';
import type { FacilitatorClient } from '@x402/core/server';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { startGateway, type GatewayHandle } from '../src/server.js';

/**
 * The gateway against a fake facilitator and a fake relay: the free routes answer without
 * payment, a priced route challenges with the HBAR price and pay-to account, and a paid retry
 * is verified, settled, forwarded upstream and returned with the settlement receipt.
 */

const PAY_TO = '0.0.10511371';
const FEE_PAYER = '0.0.7777';

function fakeFacilitator(log: string[]): FacilitatorClient {
  return {
    async getSupported() {
      return {
        kinds: [{ x402Version: 2, scheme: 'exact', network: 'hedera:testnet', extra: { feePayer: FEE_PAYER } }],
        extensions: [],
        signers: {},
      };
    },
    async verify(payload: PaymentPayload, requirements: PaymentRequirements) {
      log.push(`verify ${requirements.amount} to ${requirements.payTo}`);
      return { isValid: true, payer: '0.0.1234' };
    },
    async settle(payload: PaymentPayload, requirements: PaymentRequirements) {
      log.push(`settle ${requirements.amount}`);
      return { success: true, transaction: '0.0.1234@1700000000.000000001', network: 'hedera:testnet', payer: '0.0.1234' };
    },
  };
}

const upstreamFetch: typeof fetch = async (input) => {
  const url = new URL(String(input));
  return new Response(JSON.stringify({ path: url.pathname, query: url.search, scarcityScoreBps: 1234 }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

let handle: GatewayHandle;
let base: string;
let log: string[];

beforeEach(async () => {
  log = [];
  handle = await startGateway({
    port: 0,
    host: '127.0.0.1',
    payTo: PAY_TO,
    upstreamBaseUrl: 'http://relay.internal:8090',
    facilitator: fakeFacilitator(log),
    fetchImpl: upstreamFetch,
  });
  base = `http://127.0.0.1:${handle.port}`;
});

afterEach(async () => {
  await handle.close();
});

describe('x402 gateway', () => {
  it('serves /health and /v1/pricing for free, with CORS open', async () => {
    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    expect(health.headers.get('access-control-allow-origin')).toBe('*');
    expect(await health.json()).toMatchObject({ ok: true, payTo: PAY_TO });

    const pricing = (await (await fetch(`${base}/v1/pricing`)).json()) as { endpoints: Array<{ id: string }> };
    expect(pricing.endpoints.map((e) => e.id)).toEqual(['ecosystem', 'chain', 'vault', 'quote-context']);
    expect(log).toEqual([]);
  });

  it('answers a priced route without payment with 402 and the HBAR requirement', async () => {
    const response = await fetch(`${base}/v1/intelligence/ecosystem`, { headers: { accept: 'application/json' } });
    expect(response.status).toBe(402);
    const header = response.headers.get('payment-required');
    expect(header).toBeTruthy();
    const required = decodePaymentRequiredHeader(header!);
    expect(required.accepts).toHaveLength(1);
    expect(required.accepts[0]).toMatchObject({
      scheme: 'exact',
      network: 'hedera:testnet',
      asset: '0.0.0',
      amount: '1000000',
      payTo: PAY_TO,
      extra: { feePayer: FEE_PAYER },
    });
    expect(log).toEqual([]);
  });

  it('prices the wildcard and query-string routes', async () => {
    const vault = await fetch(`${base}/v1/intelligence/vault/5042002/0xB4bA190D5C78869366e7963f5CcCf4c3167d855C`);
    expect(vault.status).toBe(402);
    expect(decodePaymentRequiredHeader(vault.headers.get('payment-required')!).accepts[0]!.amount).toBe('500000');

    const quote = await fetch(`${base}/v1/intelligence/quote-context?amount=20000000&destinationChainId=5042002`);
    expect(quote.status).toBe(402);
    expect(decodePaymentRequiredHeader(quote.headers.get('payment-required')!).accepts[0]!.amount).toBe('2000000');
  });

  it('verifies, settles, proxies upstream and returns the receipt on a paid request', async () => {
    const challenge = await fetch(`${base}/v1/intelligence/quote-context?amount=20000000&destinationChainId=5042002`);
    const required = decodePaymentRequiredHeader(challenge.headers.get('payment-required')!);
    const payload: PaymentPayload = {
      x402Version: 2,
      resource: required.resource,
      accepted: required.accepts[0]!,
      payload: { transaction: 'base64-signed-hedera-transfer' },
    };
    const paid = await fetch(`${base}/v1/intelligence/quote-context?amount=20000000&destinationChainId=5042002`, {
      headers: { 'payment-signature': encodePaymentSignatureHeader(payload) },
    });
    expect(paid.status).toBe(200);
    expect(await paid.json()).toEqual({
      path: '/v1/intelligence/quote-context',
      query: '?amount=20000000&destinationChainId=5042002',
      scarcityScoreBps: 1234,
    });
    const receipt = decodePaymentResponseHeader(paid.headers.get('payment-response')!);
    expect(receipt).toMatchObject({ success: true, transaction: '0.0.1234@1700000000.000000001', payer: '0.0.1234' });
    expect(log).toEqual([`verify 2000000 to ${PAY_TO}`, 'settle 2000000']);
  });

  it('relays an upstream failure as its own status rather than charging for nothing twice', async () => {
    const dead = await startGateway({
      port: 0,
      host: '127.0.0.1',
      payTo: PAY_TO,
      upstreamBaseUrl: 'http://relay.internal:8090',
      facilitator: fakeFacilitator([]),
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    try {
      const challenge = await fetch(`http://127.0.0.1:${dead.port}/v1/intelligence/ecosystem`);
      const required = decodePaymentRequiredHeader(challenge.headers.get('payment-required')!);
      const paid = await fetch(`http://127.0.0.1:${dead.port}/v1/intelligence/ecosystem`, {
        headers: {
          'payment-signature': encodePaymentSignatureHeader({
            x402Version: 2,
            resource: required.resource,
            accepted: required.accepts[0]!,
            payload: { transaction: 'x' },
          }),
        },
      });
      expect(paid.status).toBe(502);
      expect(await paid.json()).toMatchObject({ error: expect.stringContaining('unreachable') });
    } finally {
      await dead.close();
    }
  });
});
