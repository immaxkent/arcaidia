/**
 * WP-35 — the Hedera x402 gateway: an HTTP 402 paywall in front of the relay's intelligence
 * endpoints. Anyone (a solver, an agent, a curl) GETs a priced route, receives `402` with the
 * HBAR price and pay-to account in `PAYMENT-REQUIRED`, signs a Hedera transfer, retries with
 * `PAYMENT-SIGNATURE`, and the facilitator verifies and settles it on Hedera testnet before the
 * relay's answer is returned with the settlement receipt in `PAYMENT-RESPONSE`.
 *
 * Express because `@x402/express` is the reference middleware; everything around it is kept as
 * small as the relay's `node:http` surface. The pay-to account is the operator's — nothing here
 * ever holds a key.
 */
import express, { type Express, type RequestHandler } from 'express';
import { HTTPFacilitatorClient, x402ResourceServer, type FacilitatorClient, type RoutesConfig } from '@x402/core/server';
import { paymentMiddleware } from '@x402/express';
import { ExactHederaScheme } from '@x402/hedera/exact/server';
import { HBAR_ASSET, HEDERA_TESTNET_NETWORK, PRICED_ENDPOINTS, pricingDirectory } from './pricing.js';
import { UpstreamProxy } from './proxy.js';

/** Blocky402's public Hedera testnet facilitator — the one the Hedera bounty asks for. */
export const DEFAULT_FACILITATOR_URL = 'https://api.testnet.blocky402.com';

export interface GatewayOptions {
  /**
   * The Hedera account (`0.0.x`) every payment lands in. Must differ from any paying solver's
   * `HEDERA_ACCOUNT_ID`: Hedera nets a transfer from an account to itself to zero, and the
   * facilitator then rejects it as `amount_mismatch`.
   */
  readonly payTo: string;
  /** Where `/v1/intelligence/*` is fetched from after payment — the relay. */
  readonly upstreamBaseUrl: string;
  readonly facilitatorUrl?: string;
  /** Tests inject a fake facilitator; production builds an `HTTPFacilitatorClient`. */
  readonly facilitator?: FacilitatorClient;
  readonly fetchImpl?: typeof fetch;
  /** Reported by `/health` and `/v1/pricing`; defaults to the facilitator URL. */
  readonly upstreamTimeoutMs?: number;
}

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  // The x402 payment headers must be readable and sendable from a browser: the `/intelligence`
  // page pays from the user's Hedera account and shows the receipt it gets back.
  'access-control-allow-headers': 'content-type, payment-signature, x-payment, payment-required',
  'access-control-expose-headers': 'payment-required, payment-response, x-payment-response',
} as const;

const cors: RequestHandler = (req, res, next) => {
  for (const [name, value] of Object.entries(CORS_HEADERS)) res.setHeader(name, value);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
};

export function routesConfig(payTo: string): RoutesConfig {
  return Object.fromEntries(
    PRICED_ENDPOINTS.map((endpoint) => [
      endpoint.pattern,
      {
        accepts: {
          scheme: 'exact',
          network: HEDERA_TESTNET_NETWORK,
          payTo,
          price: { asset: HBAR_ASSET, amount: endpoint.tinybar.toString() },
          maxTimeoutSeconds: 120,
        },
        description: endpoint.description,
        mimeType: 'application/json',
        serviceName: 'Arcaidia intelligence',
      },
    ]),
  );
}

export function createGatewayApp(options: GatewayOptions): Express {
  const facilitatorUrl = options.facilitatorUrl ?? DEFAULT_FACILITATOR_URL;
  // Blocky402's testnet endpoint has been seen to take >10s to accept a connection; the client's
  // default 30s request timeout is kept and the first request retries initialisation on failure.
  const facilitator = options.facilitator ?? new HTTPFacilitatorClient({ url: facilitatorUrl, timeoutMs: 30_000 });
  const resourceServer = new x402ResourceServer(facilitator).register(HEDERA_TESTNET_NETWORK, new ExactHederaScheme({}));
  const proxy = new UpstreamProxy({
    upstreamBaseUrl: options.upstreamBaseUrl,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.upstreamTimeoutMs !== undefined ? { timeoutMs: options.upstreamTimeoutMs } : {}),
  });

  const app = express();
  app.disable('x-powered-by');
  app.use(cors);

  app.get('/health', (_req, res) => {
    res.json({ ok: true, network: HEDERA_TESTNET_NETWORK, payTo: options.payTo, facilitator: facilitatorUrl, upstream: options.upstreamBaseUrl });
  });
  app.get('/v1/pricing', (_req, res) => {
    res.json(pricingDirectory(options.payTo, facilitatorUrl));
  });

  app.use(paymentMiddleware(routesConfig(options.payTo), resourceServer));

  app.get('/v1/intelligence/*', async (req, res) => {
    const upstream = await proxy.forward(req.originalUrl);
    res.status(upstream.status).type(upstream.contentType).send(upstream.body);
  });

  app.use((_req, res) => {
    res.status(404).json({ error: 'Unknown route. Free: /health, /v1/pricing. Paid: /v1/intelligence/*.' });
  });

  return app;
}

export interface GatewayHandle {
  readonly port: number;
  close(): Promise<void>;
}

export function startGateway(options: GatewayOptions & { port: number; host?: string }): Promise<GatewayHandle> {
  const app = createGatewayApp(options);
  return new Promise((resolve, reject) => {
    const server = app.listen(options.port, options.host ?? '0.0.0.0');
    server.once('error', reject);
    server.once('listening', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : options.port;
      resolve({
        port,
        close: () => new Promise<void>((done, fail) => server.close((error) => (error ? fail(error) : done()))),
      });
    });
  });
}
