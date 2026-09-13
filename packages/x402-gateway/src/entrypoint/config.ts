/**
 * Environment for the gateway process. Only the pay-to account is needed — the gateway never
 * signs anything, so `HEDERA_PRIVATE_KEY` is deliberately not read here (that key belongs to the
 * paying side, the solver).
 */
export class ConfigError extends Error {}

export interface GatewayConfig {
  readonly port: number;
  readonly payTo: string;
  readonly upstreamBaseUrl: string;
  readonly facilitatorUrl: string | undefined;
}

const HEDERA_ACCOUNT = /^0\.0\.[0-9]+$/;

export function loadGatewayConfig(env: NodeJS.ProcessEnv): GatewayConfig {
  // X402_PAY_TO first: on a box where the House solver also pays (HEDERA_ACCOUNT_ID), the
  // gateway needs a *different* account — a self-transfer nets to zero and fails verification.
  const payTo = env.X402_PAY_TO ?? env.HEDERA_ACCOUNT_ID ?? '';
  if (!HEDERA_ACCOUNT.test(payTo)) {
    throw new ConfigError('X402_PAY_TO (or HEDERA_ACCOUNT_ID) must be a Hedera account id like 0.0.12345.');
  }
  const upstreamBaseUrl = env.INTELLIGENCE_UPSTREAM ?? '';
  if (!/^https?:\/\//.test(upstreamBaseUrl)) {
    throw new ConfigError('INTELLIGENCE_UPSTREAM must be the relay URL serving /v1/intelligence/* (e.g. http://relay:8090).');
  }
  const port = Number(env.X402_GATEWAY_PORT ?? '8402');
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new ConfigError('X402_GATEWAY_PORT must be a port number.');
  }
  return {
    port,
    payTo,
    upstreamBaseUrl: upstreamBaseUrl.replace(/\/+$/, ''),
    facilitatorUrl: env.X402_FACILITATOR_URL || undefined,
  };
}
