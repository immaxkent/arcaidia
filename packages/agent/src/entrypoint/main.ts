#!/usr/bin/env node
/**
 * The live solver process.
 *
 * Run with: tsx packages/agent/src/entrypoint/main.ts
 * (or, from the repo root: pnpm solver:start — see root package.json)
 *
 * Reads env, builds the real adapters, and calls startSolverWorker — nothing
 * here is solver logic; that all lives in run-solver-pass.ts / solver-worker.ts
 * and is unit-tested there. This file's only job is turning process.env into a
 * running process, and logging what it's doing loudly enough that "is this
 * thing actually working" never requires reading the source to answer.
 */

import { appendFileSync } from 'node:fs';
import { JsonLinesDecisionLog, startSolverWorker, type SolverPassResult } from '../index.js';
import { buildSolverDependencies } from './build-dependencies.js';
import { ConfigError, loadSolverConfig } from './config.js';
import { startQuoteServer } from './quote-server.js';

function logPass(result: SolverPassResult): void {
  if (result.kind === 'DISCOVERY_FAILED') {
    console.error(`[solver] discovery failed: ${result.error.message}`);
    return;
  }
  for (const [intentId, outcome] of result.outcomes) {
    if (outcome.kind === 'ERROR') {
      console.error(`[solver] ${intentId}: ERROR ${outcome.error.message}`);
    } else {
      console.log(`[solver] ${intentId}: ${outcome.kind}`);
    }
  }
}

async function main(): Promise<void> {
  let config;
  try {
    config = loadSolverConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`[solver] config error: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const decisionLogPath = process.env.SOLVER_DECISION_LOG_PATH ?? 'solver-decisions.jsonl';
  const log = new JsonLinesDecisionLog((line) => appendFileSync(decisionLogPath, `${line}\n`));

  const { deps, signerAddress, submitterAddress } = buildSolverDependencies(config, { log });

  console.log('[solver] starting');
  console.log(`[solver] signer    ${signerAddress}`);
  console.log(`[solver] submitter ${submitterAddress}`);
  console.log(`[solver] decisions -> ${decisionLogPath}`);
  for (const chain of config.chains) {
    console.log(`[solver] chain ${chain.chainId}: router ${chain.intentRouter}, vault ${chain.liquidityVault}`);
    console.log(`[solver] chain ${chain.chainId}: subgraph ${chain.subgraphUrl}`);
  }

  const handle = startSolverWorker(deps, {
    pollIntervalMs: config.pollIntervalMs,
    onPass: logPass,
    onError: (error) => console.error(`[solver] unexpected error: ${error.message}`, error),
  });

  // WP-14: the live quote endpoint, colocated — same observation provider,
  // same policy, no second copy of either.
  const quoteServer = await startQuoteServer(
    { observation: deps.observation, policy: deps.config.policy, clock: deps.clock },
    { port: config.quotePort },
  );
  console.log(`[solver] quote endpoint -> http://0.0.0.0:${quoteServer.port}/quote`);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      console.log(`[solver] ${signal} received, stopping after the current pass`);
      handle.stop();
      void quoteServer.close();
      process.exit(0);
    });
  }
}

main().catch((error: unknown) => {
  console.error('[solver] fatal startup error:', error);
  process.exitCode = 1;
});
