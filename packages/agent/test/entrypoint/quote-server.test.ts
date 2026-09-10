import { afterEach, describe, expect, it } from 'vitest';
import { Verdict } from '@arcaidia/domain';
import { DEFAULT_RISK_POLICY } from '../../src/index.js';
import { startQuoteServer, type QuoteServerHandle } from '../../src/entrypoint/quote-server.js';
import { ARC, NOW, SEPOLIA, USDC, health, vault } from '../fixtures.js';
import { FakeObservationProvider } from '../solver-fakes.js';

/** The test only ever reads a handful of fields off a real JSON response. */
type RawResponse = Record<string, unknown>;
const json = (response: Response): Promise<RawResponse> => response.json() as Promise<RawResponse>;

/**
 * Real HTTP requests against a real, briefly-live server — port 0 asks the OS
 * for a free one, so these never collide with anything else running locally.
 */
async function startServer(overrides: { vault?: ReturnType<typeof vault>; health?: ReturnType<typeof health> } = {}) {
  const observation = new FakeObservationProvider(overrides.vault ?? vault(), overrides.health ?? health());
  const handle = await startQuoteServer(
    { observation, policy: DEFAULT_RISK_POLICY, clock: () => NOW },
    { port: 0 },
  );
  return { handle, observation };
}

const REQUEST_BODY = {
  amount: USDC(1_000).toString(),
  maxFeeBps: 100,
  sourceChainId: SEPOLIA,
  destinationChainId: ARC,
};

describe('quote server', () => {
  let handle: QuoteServerHandle | null = null;

  afterEach(async () => {
    if (handle) await handle.close();
    handle = null;
  });

  // -----------------------------------------------------------------------
  // Happy path
  // -----------------------------------------------------------------------

  it('POST /quote returns a real ACCEPT estimate over HTTP', async () => {
    const started = await startServer();
    handle = started.handle;

    const response = await fetch(`http://127.0.0.1:${handle.port}/quote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(REQUEST_BODY),
    });

    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body.verdict).toBe(Verdict.ACCEPT);
    expect(body.estimatedUnderAssumption).toBe(true);
    // bigints cross as strings over JSON
    expect(typeof body.outputAmount).toBe('string');
  });

  it('sets CORS headers on a real response', async () => {
    const started = await startServer();
    handle = started.handle;

    const response = await fetch(`http://127.0.0.1:${handle.port}/quote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(REQUEST_BODY),
    });

    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('answers an OPTIONS preflight without invoking the observation provider', async () => {
    const started = await startServer();
    handle = started.handle;

    const response = await fetch(`http://127.0.0.1:${handle.port}/quote`, { method: 'OPTIONS' });
    expect(response.status).toBe(204);
    expect(started.observation.vaultStateCalls).toBe(0);
  });

  it('GET /health answers ok, for cheap reachability checks', async () => {
    const started = await startServer();
    handle = started.handle;

    const response = await fetch(`http://127.0.0.1:${handle.port}/health`);
    expect(response.status).toBe(200);
    expect((await json(response)).status).toBe('ok');
  });

  // -----------------------------------------------------------------------
  // Sad paths
  // -----------------------------------------------------------------------

  it('a REJECT verdict still returns 200 — refusal is a valid, real answer, not an HTTP error', async () => {
    const started = await startServer({ vault: vault({ paused: true }) });
    handle = started.handle;

    const response = await fetch(`http://127.0.0.1:${handle.port}/quote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(REQUEST_BODY),
    });

    expect(response.status).toBe(200);
    expect((await json(response)).verdict).toBe(Verdict.PAUSE);
  });

  it('malformed JSON body returns 400, not a 500 or a crash', async () => {
    const started = await startServer();
    handle = started.handle;

    const response = await fetch(`http://127.0.0.1:${handle.port}/quote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });

    expect(response.status).toBe(400);
  });

  it('a negative amount returns 400 with a clear message', async () => {
    const started = await startServer();
    handle = started.handle;

    const response = await fetch(`http://127.0.0.1:${handle.port}/quote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...REQUEST_BODY, amount: '-5' }),
    });

    expect(response.status).toBe(400);
    expect((await json(response)).error).toMatch(/positive/);
  });

  it('a missing field returns 400 rather than throwing inside evaluateIntent', async () => {
    const started = await startServer();
    handle = started.handle;

    const response = await fetch(`http://127.0.0.1:${handle.port}/quote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amount: REQUEST_BODY.amount }),
    });

    expect(response.status).toBe(400);
  });

  it('GET /quote (wrong method) returns 404', async () => {
    const started = await startServer();
    handle = started.handle;

    const response = await fetch(`http://127.0.0.1:${handle.port}/quote`);
    expect(response.status).toBe(404);
  });

  it('an unknown path returns 404', async () => {
    const started = await startServer();
    handle = started.handle;

    const response = await fetch(`http://127.0.0.1:${handle.port}/nonsense`);
    expect(response.status).toBe(404);
  });

  it('close() actually stops the server — a further request fails to connect', async () => {
    const started = await startServer();
    const port = started.handle.port;
    await started.handle.close();
    handle = null;

    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
  });
});
