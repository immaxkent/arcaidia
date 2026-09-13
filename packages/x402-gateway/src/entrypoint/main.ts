#!/usr/bin/env node
/**
 * The live x402 gateway process (WP-35).
 *
 * Run with: tsx --env-file=.env packages/x402-gateway/src/entrypoint/main.ts
 * (or, from the repo root: pnpm gateway:start)
 */
import { DEFAULT_FACILITATOR_URL, startGateway } from '../index.js';
import { ConfigError, loadGatewayConfig } from './config.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadGatewayConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`[x402-gateway] config error: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const handle = await startGateway({
    port: config.port,
    payTo: config.payTo,
    upstreamBaseUrl: config.upstreamBaseUrl,
    ...(config.facilitatorUrl ? { facilitatorUrl: config.facilitatorUrl } : {}),
  });
  console.log(`[x402-gateway] listening on :${handle.port}`);
  console.log(`[x402-gateway] pay-to ${config.payTo} on hedera:testnet via ${config.facilitatorUrl ?? DEFAULT_FACILITATOR_URL}`);
  console.log(`[x402-gateway] upstream ${config.upstreamBaseUrl}`);

  const shutdown = async (): Promise<void> => {
    console.log('[x402-gateway] shutting down');
    await handle.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error) => {
  console.error('[x402-gateway] fatal', error);
  process.exitCode = 1;
});
