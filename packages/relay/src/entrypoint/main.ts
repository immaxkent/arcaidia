#!/usr/bin/env node
/**
 * The live Telemetry Relay process (WP-18).
 *
 * Run with: tsx packages/relay/src/entrypoint/main.ts
 * (or, from the repo root: pnpm relay:start)
 *
 * Holds no vault custody and calls no contract (WP-18.5) — this process only
 * ever remembers "has this operator proven it holds this key" and "when did
 * we last hear from it," and republishes pre-chain stages over SSE. If it is
 * down, every conforming solver keeps discovering, verifying, deciding,
 * filling and getting reimbursed exactly as WP-17.4's kill-the-Relay test
 * proves — only the console's live view degrades.
 */

import {
  FetchNestQueryClient,
  FixtureVaultFlowSource,
  ParticipantRegistry,
  RelayStore,
  VaultFlowsService,
  startHeartbeatSweeper,
  startRelayServer,
} from '../index.js';
import { ConfigError, loadRelayConfig } from './config.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadRelayConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`[relay] config error: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const store = new RelayStore({ heartbeatTimeoutSeconds: config.heartbeatTimeoutSeconds });
  const sweeper = startHeartbeatSweeper(() => store.sweepHeartbeats(), {
    intervalMs: config.heartbeatSweepIntervalMs,
  });

  console.log('[relay] starting');
  console.log(
    `[relay] heartbeat timeout ${config.heartbeatTimeoutSeconds}s, swept every ${config.heartbeatSweepIntervalMs}ms`,
  );

  const vaultFlows = config.vaultFlows
    ? new VaultFlowsService(
        new ParticipantRegistry(config.vaultFlows.nestEndpoint, new FetchNestQueryClient()),
        new FixtureVaultFlowSource(config.vaultFlows.fixturePath),
      )
    : undefined;
  console.log(
    vaultFlows
      ? `[relay] vault flows -> fixture ${config.vaultFlows!.fixturePath}, participants from ${config.vaultFlows!.nestEndpoint}`
      : '[relay] vault flows  disabled (WP-21 — no live Substreams subscriber wired yet)',
  );

  const server = await startRelayServer(store, { port: config.port, vaultFlows });
  console.log(`[relay] listening on http://0.0.0.0:${server.port}`);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      console.log(`[relay] ${signal} received, stopping`);
      sweeper.stop();
      void server.close();
      process.exit(0);
    });
  }
}

main().catch((error: unknown) => {
  console.error('[relay] fatal startup error:', error);
  process.exitCode = 1;
});
