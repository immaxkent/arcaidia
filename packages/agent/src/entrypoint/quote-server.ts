/**
 * `POST /quote` — the live estimate endpoint (WP-14).
 *
 * Colocated in the solver process rather than a standalone service: it reuses
 * the exact same `ObservationProvider` and `RiskPolicy` the solver acts on for
 * real, so there is only ever one policy version and one view of vault state
 * in force. Node's own `http` module, deliberately — this is one route with
 * no auth and no session state, not enough surface to justify a framework
 * dependency this package has never needed before.
 *
 * CORS is open (`*`): the same trust level as the public subgraph endpoints
 * the frontend already calls directly, and a quote is read-only and reveals
 * nothing an unauthenticated subgraph query couldn't already answer.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { buildQuote, InvalidQuoteRequestError, type QuoteDependencies, type QuoteRequest } from '../index.js';

export interface QuoteServerOptions {
  readonly port: number;
  /** Bind address; defaults to all interfaces. */
  readonly host?: string;
}

export interface QuoteServerHandle {
  close(): Promise<void>;
  readonly port: number;
}

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
} as const;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body, (_key, value) => (typeof value === 'bigint' ? value.toString() : value));
  res.writeHead(status, { ...CORS_HEADERS, 'content-type': 'application/json' });
  res.end(json);
}

/** Every bigint field a `QuoteRequest` carries arrives as a JSON string or number over HTTP. */
function parseQuoteRequest(raw: unknown): QuoteRequest {
  if (typeof raw !== 'object' || raw === null) {
    throw new InvalidQuoteRequestError('Request body must be a JSON object.');
  }
  const body = raw as Record<string, unknown>;

  const amount = body.amount;
  const maxFeeBps = body.maxFeeBps;
  const sourceChainId = body.sourceChainId;
  const destinationChainId = body.destinationChainId;

  if (typeof amount !== 'string' && typeof amount !== 'number') {
    throw new InvalidQuoteRequestError('amount must be a string or number (USDC smallest unit).');
  }
  if (typeof maxFeeBps !== 'number') throw new InvalidQuoteRequestError('maxFeeBps must be a number.');
  if (typeof sourceChainId !== 'number') throw new InvalidQuoteRequestError('sourceChainId must be a number.');
  if (typeof destinationChainId !== 'number') {
    throw new InvalidQuoteRequestError('destinationChainId must be a number.');
  }

  let parsedAmount: bigint;
  try {
    parsedAmount = BigInt(amount);
  } catch {
    throw new InvalidQuoteRequestError('amount is not a valid integer.');
  }

  return { amount: parsedAmount, maxFeeBps, sourceChainId, destinationChainId };
}

/**
 * Starts listening and resolves once the real bound port is known — `options.port`
 * of `0` asks the OS for any free port (used by tests), so the caller cannot
 * know the actual port until `listening` fires.
 */
export function startQuoteServer(
  deps: QuoteDependencies,
  options: QuoteServerOptions,
): Promise<QuoteServerHandle> {
  const server = createServer((req, res) => {
    void handleRequest(req, res, deps);
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
          }),
      });
    });
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: QuoteDependencies,
): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    send(res, 200, { status: 'ok' });
    return;
  }

  if (req.method !== 'POST' || req.url !== '/quote') {
    send(res, 404, { error: 'Not found. POST /quote.' });
    return;
  }

  try {
    const body = await readBody(req);
    const request = parseQuoteRequest(body.length > 0 ? JSON.parse(body) : {});
    const quote = await buildQuote(request, deps);
    send(res, 200, quote);
  } catch (error) {
    if (error instanceof InvalidQuoteRequestError) {
      send(res, 400, { error: error.message });
      return;
    }
    if (error instanceof SyntaxError) {
      send(res, 400, { error: 'Request body is not valid JSON.' });
      return;
    }
    send(res, 500, { error: error instanceof Error ? error.message : 'Internal error.' });
  }
}
