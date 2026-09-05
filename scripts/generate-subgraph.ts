/**
 * Generates one subgraph manifest per chain from the shared configuration.
 *
 * Addresses, chain names and start blocks are read from `@arcaidia/domain`
 * rather than typed into YAML. A subgraph pointed at the wrong address indexes
 * nothing and reports an empty world, which the solver reads as "no work" — a
 * silent failure that looks exactly like a quiet day.
 *
 * `--check` fails when the committed manifests are stale, in the same way
 * `abi:check` does for the ABI barrel.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAINS, deploymentFor, type ChainConfig, type ChainKey } from '../packages/domain/src/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SUBGRAPH = join(ROOT, 'subgraph');

/**
 * Where each chain's indexing begins.
 *
 * Zero is wrong for a real deployment — it would replay the entire chain — so
 * this is filled in with the protocol's deployment block when WP-10 deploys.
 */
const START_BLOCKS: Record<ChainKey, number> = {
  'ethereum-sepolia': 0,
  'arc-testnet': 0,
};

function manifest(chain: ChainConfig): string {
  const contracts = deploymentFor(chain.key);
  const router = contracts.intentRouter ?? PLACEHOLDER;
  const vault = contracts.liquidityVault ?? PLACEHOLDER;
  const receiver = contracts.settlementReceiver ?? PLACEHOLDER;
  const startBlock = START_BLOCKS[chain.key];

  return `# GENERATED — do not edit. Run \`pnpm subgraph:generate\`.
#
# Addresses come from packages/domain/src/config, so a manifest can never point
# somewhere the rest of the system does not. A subgraph indexing the wrong
# address reports an empty world, which the solver reads as "no work" — a
# failure indistinguishable from a quiet day.
specVersion: 1.0.0
description: Arcaidia intents, fills and canonical settlement on ${chain.name}.
repository: https://github.com/immaxkent/arcaidia
schema:
  file: ./schema.graphql

dataSources:
  - kind: ethereum
    name: ArcaidiaIntentRouter
    network: ${chain.graphNetwork}
    source:
      address: "${router}"
      abi: ArcaidiaIntentRouter
      startBlock: ${startBlock}
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.7
      language: wasm/assemblyscript
      file: ./src/router.ts
      entities: [Intent, ProtocolState]
      abis:
        - name: ArcaidiaIntentRouter
          file: ./abis/ArcaidiaIntentRouter.json
      eventHandlers:
        - event: IntentCreated(indexed bytes32,indexed address,indexed address,address,uint256,uint256,uint256,uint16,uint64,uint256,bytes32)
          handler: handleIntentCreated

  - kind: ethereum
    name: ArcaidiaLiquidityVault
    network: ${chain.graphNetwork}
    source:
      address: "${vault}"
      abi: ArcaidiaLiquidityVault
      startBlock: ${startBlock}
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.7
      language: wasm/assemblyscript
      file: ./src/vault.ts
      entities: [Intent, Fill, Vault, ProtocolState]
      abis:
        - name: ArcaidiaLiquidityVault
          file: ./abis/ArcaidiaLiquidityVault.json
      eventHandlers:
        - event: FastFilled(indexed bytes32,indexed address,indexed address,uint256,uint256,uint256)
          handler: handleFastFilled
        - event: Deposit(indexed address,indexed address,uint256,uint256)
          handler: handleDeposit
        - event: Withdraw(indexed address,indexed address,indexed address,uint256,uint256)
          handler: handleWithdraw
        - event: ReimbursementRecorded(indexed bytes32,uint256,uint256)
          handler: handleReimbursement
        - event: FeesAccrued(indexed bytes32,uint256,uint256)
          handler: handleFeesAccrued
        - event: PausedSet(bool)
          handler: handlePausedSet

  - kind: ethereum
    name: SettlementReceiver
    network: ${chain.graphNetwork}
    source:
      address: "${receiver}"
      abi: SettlementReceiver
      startBlock: ${startBlock}
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.7
      language: wasm/assemblyscript
      file: ./src/settlement.ts
      entities: [Intent, Settlement, ProtocolState]
      abis:
        - name: SettlementReceiver
          file: ./abis/SettlementReceiver.json
      eventHandlers:
        - event: LpReimbursed(indexed bytes32,uint256)
          handler: handleLpReimbursed
        - event: RecipientPaidByFallback(indexed bytes32,indexed address,uint256)
          handler: handleRecipientPaidByFallback
`;
}

/** Stands in until WP-10 deploys and writes real addresses into the config. */
const PLACEHOLDER = '0x0000000000000000000000000000000000000000';

const targets = (Object.keys(CHAINS) as ChainKey[]).map((key) => ({
  key,
  path: join(SUBGRAPH, `subgraph.${key}.yaml`),
  content: manifest(CHAINS[key]),
}));

// The ABIs the mappings decode against, taken from the same barrel every other
// package uses.
function writeAbis(): void {
  mkdirSync(join(SUBGRAPH, 'abis'), { recursive: true });
  for (const name of ['ArcaidiaIntentRouter', 'ArcaidiaLiquidityVault', 'SettlementReceiver']) {
    const artifact = JSON.parse(
      readFileSync(join(ROOT, 'contracts', 'out', `${name}.sol`, `${name}.json`), 'utf8'),
    ) as { abi: unknown };
    writeFileSync(join(SUBGRAPH, 'abis', `${name}.json`), `${JSON.stringify(artifact.abi, null, 2)}\n`);
  }
}

const check = process.argv.includes('--check');
let stale = false;

for (const target of targets) {
  if (check) {
    let current = '';
    try {
      current = readFileSync(target.path, 'utf8');
    } catch {
      /* missing counts as stale */
    }
    if (current !== target.content) {
      console.error(`${target.path} is stale.`);
      stale = true;
    }
  } else {
    writeFileSync(target.path, target.content);
  }
}

if (!check) writeAbis();

if (check && stale) {
  console.error('Run `pnpm subgraph:generate` and commit the result.');
  process.exit(1);
}

console.log(check ? 'Subgraph manifests are up to date.' : `Wrote ${targets.length} manifests and 3 ABIs.`);
