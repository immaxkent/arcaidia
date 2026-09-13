import { describe, expect, it } from 'vitest';
import { encodePaymentResponseHeader } from '@x402/core/http';
import { PrivateKey } from '@x402/hedera';
import { PaymentLedger, createHederaPayingFetch, parseHederaPrivateKey } from '../src/adapters/x402-paying-fetch.js';
import { HttpIntelligenceProvider } from '../src/adapters/http-intelligence-provider.js';

/**
 * The paying fetch is `@x402/fetch` plus a ledger. What is ours to prove: a response that was
 * never a 402 passes through unpaid and unrecorded; a paid response's `PAYMENT-RESPONSE` becomes
 * a receipt the provider reports; a malformed or failed receipt is ignored. The 402 → sign →
 * retry protocol itself is the library's, exercised end to end against the real gateway later.
 */

const KEY = PrivateKey.generateECDSA();
const RECEIPT = encodePaymentResponseHeader({
  success: true,
  transaction: '0.0.4444@1700000000.123456789',
  network: 'hedera:testnet',
  payer: '0.0.4444',
  amount: '1000000',
});

describe('parseHederaPrivateKey', () => {
  it('accepts raw hex with or without 0x', () => {
    const hex = KEY.toStringRaw();
    expect(parseHederaPrivateKey(hex).toStringRaw()).toBe(hex);
    expect(parseHederaPrivateKey(`0x${hex}`).toStringRaw()).toBe(hex);
  });
});

describe('PaymentLedger', () => {
  it('records a settled receipt and sums the amounts', () => {
    const ledger = new PaymentLedger(() => 99);
    expect(ledger.recordFrom(new Response('{}', { headers: { 'payment-response': RECEIPT } }))).toEqual({
      network: 'hedera:testnet',
      transaction: '0.0.4444@1700000000.123456789',
      payer: '0.0.4444',
      amount: '1000000',
      paidAt: 99,
    });
    ledger.recordFrom(new Response('{}', { headers: { 'x-payment-response': RECEIPT } }));
    expect(ledger.summary()).toMatchObject({ payments: 2, totalTinybar: 2_000_000n });
  });

  it('ignores responses with no receipt, a malformed one, or a failed settlement', () => {
    const ledger = new PaymentLedger();
    expect(ledger.recordFrom(new Response('{}'))).toBeNull();
    expect(ledger.recordFrom(new Response('{}', { headers: { 'payment-response': 'not-base64-json' } }))).toBeNull();
    const failed = encodePaymentResponseHeader({ success: false, transaction: '', network: 'hedera:testnet', errorReason: 'insufficient_funds' });
    expect(ledger.recordFrom(new Response('{}', { headers: { 'payment-response': failed } }))).toBeNull();
    expect(ledger.summary()).toEqual({ payments: 0, totalTinybar: 0n, last: null });
  });
});

describe('createHederaPayingFetch', () => {
  it('passes a non-402 response through unpaid and records a receipt when one is present', async () => {
    const calls: string[] = [];
    const { fetchImpl, ledger } = createHederaPayingFetch({
      accountId: '0.0.4444',
      privateKey: KEY.toStringRaw(),
      fetchImpl: (async (input: Parameters<typeof fetch>[0]) => {
        calls.push(input instanceof Request ? input.url : String(input));
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'payment-response': RECEIPT } });
      }) as typeof fetch,
    });
    const response = await fetchImpl('https://intel.example/v1/intelligence/ecosystem');
    expect(response.status).toBe(200);
    expect(calls).toEqual(['https://intel.example/v1/intelligence/ecosystem']);
    expect(ledger.summary().payments).toBe(1);
    expect(ledger.summary().last?.transaction).toBe('0.0.4444@1700000000.123456789');
  });

  it('is what HttpIntelligenceProvider.lastPayment() reports', async () => {
    const ledger = new PaymentLedger(() => 7);
    const provider = new HttpIntelligenceProvider({ baseUrl: 'https://intel.example', ledger });
    expect(provider.lastPayment()).toBeNull();
    ledger.recordFrom(new Response('{}', { headers: { 'payment-response': RECEIPT } }));
    expect(provider.lastPayment()?.paidAt).toBe(7);
  });
});
