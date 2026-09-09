#!/usr/bin/env node
/**
 * The live settlement worker process.
 *
 * Run with: tsx packages/settlement/src/entrypoint/main.ts
 * (or, from the repo root: pnpm settlement:start — see root package.json)
 *
 * Reads env, builds the real adapters, and calls startSettlementWorker —
 * nothing here is settlement logic; that all lives in
 * run-settlement-worker-pass.ts / process-settlement.ts and is unit-tested
 * there. This file's only job is turning process.env into a running process,
 * and logging what it's doing loudly enough that "is this thing actually
 * working" never requires reading the source to answer.
 */

import { startSettlementWorker, type SettlementWorkerPassResult } from '../index.js';
import { buildSettlementDependencies } from './build-dependencies.js';
import { ConfigError, loadSettlementConfig } from './config.js';

function logPass(result: SettlementWorkerPassResult): void {
  if (result.kind === 'DISCOVERY_FAILED') {
    console.error(`[settlement] discovery failed: ${result.error.message}`);
    return;
  }
  if (result.newlyTracked > 0) {
    console.log(`[settlement] tracking ${result.newlyTracked} newly discovered settlement(s)`);
  }
  for (const [intentId, outcome] of result.outcomes) {
    if (outcome.kind === 'FAILED' || outcome.kind === 'TRANSPORT_UNAVAILABLE') {
      console.error(`[settlement] ${intentId}: ${outcome.kind} ${outcome.error.message}`);
    } else if (outcome.kind === 'SETTLED') {
      console.log(`[settlement] ${intentId}: SETTLED (${outcome.outcome}) tx ${outcome.txHash}`);
    } else {
      console.log(`[settlement] ${intentId}: ${outcome.kind}`);
    }
  }
}

function main(): void {
  let config;
  try {
    config = loadSettlementConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`[settlement] config error: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const { deps, reporterAddress } = buildSettlementDependencies(config);

  console.log('[settlement] starting');
  console.log(`[settlement] reporter ${reporterAddress}`);
  console.log(`[settlement] iris     ${config.irisBaseUrl}`);
  for (const chain of config.chains) {
    console.log(
      `[settlement] chain ${chain.chainId}: receiver ${chain.settlementReceiver}, ` +
        `messageTransmitter ${chain.messageTransmitter}, domain ${chain.domain}`,
    );
    console.log(`[settlement] chain ${chain.chainId}: subgraph ${chain.subgraphUrl}`);
  }

  const handle = startSettlementWorker(deps, {
    pollIntervalMs: config.pollIntervalMs,
    onPass: logPass,
    onError: (error) => console.error(`[settlement] unexpected error: ${error.message}`, error),
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      console.log(`[settlement] ${signal} received, stopping after the current pass`);
      handle.stop();
      process.exit(0);
    });
  }
}

main();
