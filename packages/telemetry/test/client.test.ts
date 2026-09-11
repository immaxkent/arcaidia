import { describe, expect, it, vi } from 'vitest';
import { HttpTelemetryClient, NoopTelemetryClient } from '../src/client.js';
import type { TelemetryHeartbeat, TelemetryStageEvent } from '../src/types.js';

const NOW = 1_800_000_000;

const stageEvent = (overrides: Partial<TelemetryStageEvent> = {}): TelemetryStageEvent => ({
  chainId: 11155111,
  stage: 'INTENT_DISCOVERED',
  intentId: '0x'.padEnd(66, 'a') as `0x${string}`,
  vaultAddress: '0x1111111111111111111111111111111111111111',
  at: NOW,
  ...overrides,
});

const heartbeat = (overrides: Partial<TelemetryHeartbeat> = {}): TelemetryHeartbeat => ({
  chainId: 11155111,
  vaultAddress: '0x1111111111111111111111111111111111111111',
  operatorAddress: '0x2222222222222222222222222222222222222222',
  at: NOW,
  ...overrides,
});

function fakeFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  return vi.fn(impl) as unknown as typeof fetch;
}

describe('HttpTelemetryClient', () => {
  it('posts a stage event to the relay events endpoint', () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = fakeFetch(async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body as string) });
      return new Response(null, { status: 204 });
    });

    const client = new HttpTelemetryClient({ relayUrl: 'https://relay.example', fetchImpl });
    client.reportStage(stageEvent());

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://relay.example/v1/telemetry/events');
    expect(calls[0]?.body).toMatchObject({ stage: 'INTENT_DISCOVERED' });
  });

  it('posts a heartbeat to the relay heartbeat endpoint', () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = fakeFetch(async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body as string) });
      return new Response(null, { status: 204 });
    });

    const client = new HttpTelemetryClient({ relayUrl: 'https://relay.example', fetchImpl });
    client.heartbeat(heartbeat());

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://relay.example/v1/telemetry/heartbeat');
    expect(calls[0]?.body).toMatchObject({ operatorAddress: heartbeat().operatorAddress });
  });

  it('strips a trailing slash from the relay URL so the path never doubles up', () => {
    const calls: string[] = [];
    const fetchImpl = fakeFetch(async (url) => {
      calls.push(url);
      return new Response(null, { status: 204 });
    });

    const client = new HttpTelemetryClient({ relayUrl: 'https://relay.example/', fetchImpl });
    client.reportStage(stageEvent());

    expect(calls[0]).toBe('https://relay.example/v1/telemetry/events');
  });

  /// WP-17's own acceptance gate: a failing or hanging call must never block
  /// or delay the caller. Proven by returning before the fetch promise ever
  /// settles, not just by not throwing.
  it('returns synchronously even while the underlying request is still in flight', () => {
    let resolved = false;
    const fetchImpl = fakeFetch(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolved = true;
            resolve(new Response(null, { status: 204 }));
          }, 10_000);
        }),
    );

    const client = new HttpTelemetryClient({ relayUrl: 'https://relay.example', fetchImpl });
    client.reportStage(stageEvent());

    expect(resolved).toBe(false);
  });

  it('a rejected request is observed through onError, never thrown', async () => {
    const errors: Array<{ error: unknown; context: string }> = [];
    const fetchImpl = fakeFetch(async () => {
      throw new Error('network unreachable');
    });

    const client = new HttpTelemetryClient({
      relayUrl: 'https://relay.example',
      fetchImpl,
      onError: (error, context) => errors.push({ error, context }),
    });

    expect(() => client.reportStage(stageEvent())).not.toThrow();

    // Let the microtask queue drain so the rejection has a chance to be observed.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(errors).toHaveLength(1);
    expect(errors[0]?.context).toBe('reportStage');
    expect((errors[0]?.error as Error).message).toBe('network unreachable');
  });

  it('a rejected heartbeat is observed through onError with the right context', async () => {
    const errors: Array<{ error: unknown; context: string }> = [];
    const fetchImpl = fakeFetch(async () => {
      throw new Error('timeout');
    });

    const client = new HttpTelemetryClient({
      relayUrl: 'https://relay.example',
      fetchImpl,
      onError: (error, context) => errors.push({ error, context }),
    });

    client.heartbeat(heartbeat());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(errors[0]?.context).toBe('heartbeat');
  });

  it('never throws when no onError handler is supplied at all', async () => {
    const fetchImpl = fakeFetch(async () => {
      throw new Error('network unreachable');
    });
    const client = new HttpTelemetryClient({ relayUrl: 'https://relay.example', fetchImpl });

    expect(() => client.reportStage(stageEvent())).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // No assertion beyond "the test process itself didn't crash from an
    // unhandled rejection" — vitest fails the run on those on its own.
  });
});

describe('NoopTelemetryClient', () => {
  it('never calls out anywhere — TELEMETRY_ENABLED=false is a real, correct mode', () => {
    const client = new NoopTelemetryClient();
    expect(() => client.reportStage(stageEvent())).not.toThrow();
    expect(() => client.heartbeat(heartbeat())).not.toThrow();
  });
});
