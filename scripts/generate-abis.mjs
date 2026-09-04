#!/usr/bin/env node
/**
 * Emits Foundry's compiled ABIs into the shared domain package.
 *
 * Downstream packages must never declare a fragment of Arcaidia's interface for
 * themselves — a hand-copied ABI drifts silently and fails at runtime, usually
 * against real funds. This generates `packages/domain/src/abis.ts` from the
 * build output, and `--check` fails when the committed file is stale.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'contracts', 'out');
const TARGET = join(ROOT, 'packages', 'domain', 'src', 'abis.ts');

/** Contracts whose ABIs the rest of the system consumes. */
const CONTRACTS = [
  'ArcaidiaIntentRouter',
  'ArcaidiaLiquidityVault',
  'SettlementReceiver',
  'ArcaidiaDeployer',
  'MockUSDC',
];

function readAbi(name) {
  const path = join(OUT, `${name}.sol`, `${name}.json`);
  try {
    return JSON.parse(readFileSync(path, 'utf8')).abi;
  } catch (error) {
    throw new Error(
      `No build artifact for ${name} at ${path}. Run \`forge build\` in contracts/ first.\n${error.message}`,
    );
  }
}

function render() {
  const entries = CONTRACTS.map(
    (name) => `  ${name}: ${JSON.stringify(readAbi(name), null, 2).replace(/\n/g, '\n  ')} as const,`,
  ).join('\n');

  return `/**
 * ABI barrel — GENERATED, do not edit.
 *
 * Regenerate with \`pnpm abi:generate\` after changing any contract. The
 * \`abi:check\` script fails the build when this file is stale, so a downstream
 * package can never be compiled against an interface the contracts no longer have.
 */

export const ABIS = {
${entries}
} as const;

export type ArcaidiaAbis = typeof ABIS;
`;
}

const generated = render();

if (process.argv.includes('--check')) {
  const current = readFileSync(TARGET, 'utf8');
  if (current !== generated) {
    console.error('packages/domain/src/abis.ts is stale. Run `pnpm abi:generate` and commit the result.');
    process.exit(1);
  }
  console.log('ABI barrel is up to date.');
} else {
  writeFileSync(TARGET, generated);
  console.log(`Wrote ${CONTRACTS.length} ABIs to packages/domain/src/abis.ts`);
}
