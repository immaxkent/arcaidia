/**
 * The Relay's HTTP surface (WP-18) — `pair` / `heartbeat` / `events` / the
 * per-vault SSE stream. Plain `node:http`, same choice and same reasoning as
 * `packages/agent/src/entrypoint/quote-server.ts`: a handful of routes with
 * no session state don't earn a framework dependency.
 *
 * This is deliberately the one durable, publicly-reachable service in the
 * whole system (`WP-18-telemetry-relay.md`'s own framing) — every solver and
 * every sidecar is outbound-only. CORS is open for the same reason the quote
 * endpoint's is: everything served here is either the operator's own
 * assertion of liveness/stage (never authoritative) or a public vault's
 * telemetry, and the frontend console needs to read it with no login.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { RelayStore } from './store.js';
import type { VaultKey, VaultTelemetryState } from './types.js';

export interface RelayServerOptions {
  readonly port: number;
  readonly host?: string;
}

export interface RelayServerHandle {
  close(): Promise<void>;
  readonly port: number;
}

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
} as const;

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { ...CORS_HEADERS, 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req);
  if (raw.length === 0) return {};
  const parsed = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Request body must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

class BadRequestError extends Error {}

function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new BadRequestError(`${field} must be a non-empty string.`);
  }
  return value;
}

function requireNumber(body: Record<string, unknown>, field: string): number {
  const value = body[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new BadRequestError(`${field} must be a number.`);
  }
  return value;
}

function optionalNumber(body: Record<string, unknown>, field: string): number | undefined {
  if (!(field in body)) return undefined;
  return requireNumber(body, field);
}

function vaultKeyFromBody(body: Record<string, unknown>): VaultKey {
  return {
    chainId: requireNumber(body, 'chainId'),
    vaultAddress: (requireString(body, 'vaultAddress').toLowerCase()) as `0x${string}`,
  };
}

/** `/v1/telemetry/vault/<chainId>/<vaultAddress>/stream` — the only path with segments in it. */
function parseStreamPath(pathname: string): VaultKey | null {
  const segments = pathname.split('/').filter((s) => s.length > 0);
  if (
    segments.length !== 6 ||
    segments[0] !== 'v1' ||
    segments[1] !== 'telemetry' ||
    segments[2] !== 'vault' ||
    segments[5] !== 'stream'
  ) {
    return null;
  }
  const chainId = Number(segments[3]);
  if (!Number.isFinite(chainId)) return null;
  return { chainId, vaultAddress: segments[4]!.toLowerCase() as `0x${string}` };
}

export function startRelayServer(store: RelayStore, options: RelayServerOptions): Promise<RelayServerHandle> {
  const server = createServer((req, res) => {
    void handleRequest(req, res, store);
  });

  return new Promise((resolve) => {
    server.listen(options.port, options.host ?? '0.0.0.0', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : options.port;

      resolve({
        port,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((error) => (error ? closeReject(error) : closeResolve()));
            // SSE connections are meant to stay open indefinitely — `close()`
            // otherwise waits forever for one of them to end on its own.
            // Closing them here is what an operator restarting the process
            // would do anyway; every real client (the console) reconnects.
            server.closeAllConnections();
          }),
      });
    });
  });
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, store: RelayStore): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://relay.local');
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  if (req.method === 'GET' && pathname === '/health') {
    send(res, 200, { status: 'ok' });
    return;
  }

  if (req.method === 'GET') {
    const streamKey = parseStreamPath(pathname);
    if (streamKey) {
      handleStream(req, res, store, streamKey);
      return;
    }
  }

  if (req.method === 'POST') {
    try {
      switch (pathname) {
        case '/v1/telemetry/pair/challenge':
          await handleChallenge(req, res, store);
          return;
        case '/v1/telemetry/pair':
          await handlePair(req, res, store);
          return;
        case '/v1/telemetry/heartbeat':
          await handleHeartbeat(req, res, store);
          return;
        case '/v1/telemetry/events':
          await handleEvent(req, res, store);
          return;
      }
    } catch (error) {
      if (error instanceof BadRequestError) {
        send(res, 400, { error: error.message });
        return;
      }
      if (error instanceof SyntaxError) {
        send(res, 400, { error: 'Request body is not valid JSON.' });
        return;
      }
      send(res, 500, { error: error instanceof Error ? error.message : 'Internal error.' });
      return;
    }
  }

  send(res, 404, { error: 'Not found.' });
}

async function handleChallenge(req: IncomingMessage, res: ServerResponse, store: RelayStore): Promise<void> {
  const body = await readJson(req);
  const key = vaultKeyFromBody(body);
  const operatorAddress = requireString(body, 'operatorAddress').toLowerCase() as `0x${string}`;

  send(res, 200, store.issueChallenge(key, operatorAddress));
}

async function handlePair(req: IncomingMessage, res: ServerResponse, store: RelayStore): Promise<void> {
  const body = await readJson(req);
  const key = vaultKeyFromBody(body);
  const operatorAddress = requireString(body, 'operatorAddress').toLowerCase() as `0x${string}`;
  const challenge = requireString(body, 'challenge');
  const signature = requireString(body, 'signature') as `0x${string}`;

  const paired = await store.confirmPairing(key, operatorAddress, challenge, signature);
  if (!paired) {
    send(res, 401, { error: 'Pairing challenge/signature rejected.' });
    return;
  }
  send(res, 200, { paired: true });
}

async function handleHeartbeat(req: IncomingMessage, res: ServerResponse, store: RelayStore): Promise<void> {
  const body = await readJson(req);
  const key = vaultKeyFromBody(body);
  const operatorAddress = requireString(body, 'operatorAddress').toLowerCase() as `0x${string}`;
  const at = optionalNumber(body, 'at');

  const accepted = store.recordHeartbeat(key, operatorAddress, at);
  if (!accepted) {
    send(res, 401, { error: 'Not paired for this vault/operator.' });
    return;
  }
  res.writeHead(204, CORS_HEADERS);
  res.end();
}

async function handleEvent(req: IncomingMessage, res: ServerResponse, store: RelayStore): Promise<void> {
  const body = await readJson(req);
  const key = vaultKeyFromBody(body);
  const stage = requireString(body, 'stage');
  const intentId = requireString(body, 'intentId') as `0x${string}`;
  const at = optionalNumber(body, 'at');

  const result = store.recordStageEvent(key, stage, intentId, at);
  if (!result.ok) {
    if (result.reason === 'UNACCEPTED_STAGE') {
      send(res, 400, { error: `Telemetry may not report stage "${stage}". Only pre-chain stages are accepted.` });
    } else {
      send(res, 401, { error: 'Not paired for this vault/operator.' });
    }
    return;
  }
  res.writeHead(204, CORS_HEADERS);
  res.end();
}

function handleStream(req: IncomingMessage, res: ServerResponse, store: RelayStore, key: VaultKey): void {
  res.writeHead(200, {
    ...CORS_HEADERS,
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });

  const write = (state: VaultTelemetryState): void => {
    res.write(`data: ${JSON.stringify(state)}\n\n`);
  };

  write(store.stateOf(key));
  const unsubscribe = store.subscribe(key, write);

  req.on('close', unsubscribe);
}
