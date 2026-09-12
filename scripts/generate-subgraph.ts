/**
 * Generates one subgraph manifest per chain from the shared configuration.
 *
 * Addresses, chain names and start blocks are read from `@arcaidia/domain`
 * rather than typed into YAML. A subgraph pointed at the wrong address indexes
 * nothing and reports an empty world, which the solver reads as "no work" — a
 * silent failure that looks exactly like a quiet day.
 *
 * v2 (WP-27): event signatures are derived from the compiled ABIs rather than
 * hand-typed — found on main: the manifest still listed `LpReimbursed(indexed
 * bytes32,uint256)` after WP-16 had made it three parameters, and nothing could
 * catch that because the string was typed twice. Now the ABI is the only source.
 *
 * `--check` fails when the committed manifests are stale, in the same way
 * `abi:check` does for the ABI barrel.
 *
 * `manifest()` is exported and side-effect free (no file I/O) so
 * generate-subgraph.test.ts can assert on it directly; only the block guarded
 * by `isMain` below touches the filesystem or `process`.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ABIS, CHAINS, deploymentFor, type ChainConfig, type ChainKey } from '../packages/domain/src/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SUBGRAPH = join(ROOT, 'subgraph');

/** Stands in for a chain whose contracts aren't deployed yet. */
export const PLACEHOLDER = '0x0000000000000000000000000000000000000000';

/**
 * Where the v2 deployment's indexing begins, per chain: the block the v2
 * `SettlementReceiver` — the first of the five CREATE2 contracts — was deployed in
 * (2026-09-12, WP-31; contracts/broadcast/Deploy.s.sol/<chainId>/run-latest.json). The
 * factory (Sepolia 11688306 / Arc 61715971) and router (11688307 / 61715976) follow
 * within a few blocks; one start block per chain keeps the manifest simple at the cost
 * of a handful of empty blocks.
 */
export const START_BLOCKS: Record<ChainKey, number> = {
  'ethereum-sepolia': 11_688_303,
  'arc-testnet': 61_715_957,
};

interface AbiInput {
  readonly type: string;
  readonly indexed?: boolean;
  readonly components?: readonly AbiInput[];
}
interface AbiItem {
  readonly type: string;
  readonly name?: string;
  readonly inputs?: readonly AbiInput[];
}

function abiType(input: AbiInput): string {
  if (input.type.startsWith('tuple')) {
    const inner = (input.components ?? []).map(abiType).join(',');
    return `(${inner})${input.type.slice('tuple'.length)}`;
  }
  return input.type;
}

/**
 * The manifest form of an event signature, e.g.
 * `IntentCreated(indexed bytes32,indexed address,...)` — exactly what graph-node matches
 * against the ABI, derived from that same ABI so it cannot drift.
 */
export function eventSignature(abi: readonly unknown[], name: string): string {
  const item = (abi as readonly AbiItem[]).find((entry) => entry.type === 'event' && entry.name === name);
  if (!item) throw new Error(`No event ${name} in ABI.`);
  const params = (item.inputs ?? []).map((input) => `${input.indexed ? 'indexed ' : ''}${abiType(input)}`);
  return `${name}(${params.join(',')})`;
}

function handlers(abi: readonly unknown[], pairs: ReadonlyArray<readonly [string, string]>): string {
  return pairs
    .map(([event, handler]) => `        - event: ${eventSignature(abi, event)}\n          handler: ${handler}`)
    .join('\n');
}

const ROUTER_HANDLERS = handlers(ABIS.ArcaidiaIntentRouter, [['IntentCreated', 'handleIntentCreated']]);
const FACTORY_HANDLERS = handlers(ABIS.ArcaidiaVaultFactory, [['VaultCreated', 'handleVaultCreated']]);
const VAULT_HANDLERS = handlers(ABIS.ArcaidiaLiquidityVault, [
  ['VaultInitialized', 'handleVaultInitialized'],
  ['FastFilled', 'handleFastFilled'],
  ['DeliveredViaSwap', 'handleDeliveredViaSwap'],
  ['SwapFellBack', 'handleSwapFellBack'],
  ['Deposit', 'handleDeposit'],
  ['Withdraw', 'handleWithdraw'],
  ['ReimbursementRecorded', 'handleReimbursement'],
  ['FeesAccrued', 'handleFeesAccrued'],
  ['PausedSet', 'handlePausedSet'],
]);
const RECEIVER_HANDLERS = handlers(ABIS.SettlementReceiver, [
  ['LpReimbursed', 'handleLpReimbursed'],
  ['RecipientPaidByFallback', 'handleRecipientPaidByFallback'],
  ['HeldForVault', 'handleHeldForVault'],
  ['SettledWithProof', 'handleSettledWithProof'],
]);

export function manifest(chain: ChainConfig): string {
  const contracts = deploymentFor(chain.key);
  const router = contracts.intentRouter ?? PLACEHOLDER;
  const factory = contracts.vaultFactory ?? PLACEHOLDER;
  const receiver = contracts.settlementReceiver ?? PLACEHOLDER;
  const startBlock = START_BLOCKS[chain.key];

  return `# GENERATED — do not edit. Run \`pnpm subgraph:generate\`.
#
# Addresses come from packages/domain/src/config, so a manifest can never point
# somewhere the rest of the system does not. A subgraph indexing the wrong
# address reports an empty world, which the solver reads as "no work" — a
# failure indistinguishable from a quiet day.
#
# v2 (WP-27): three fixed data sources (router, vault factory, settlement
# receiver) and one template — every vault the factory creates, the House
# Vault included, is indexed from its own VaultCreated block on (D10).
specVersion: 1.0.0
description: Arcaidia intents, vaults, fills and canonical settlement on ${chain.name}.
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
${ROUTER_HANDLERS}

  - kind: ethereum
    name: ArcaidiaVaultFactory
    network: ${chain.graphNetwork}
    source:
      address: "${factory}"
      abi: ArcaidiaVaultFactory
      startBlock: ${startBlock}
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.7
      language: wasm/assemblyscript
      file: ./src/factory.ts
      entities: [Vault, FeeSnapshot, ProtocolState]
      abis:
        - name: ArcaidiaVaultFactory
          file: ./abis/ArcaidiaVaultFactory.json
      eventHandlers:
${FACTORY_HANDLERS}

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
${RECEIVER_HANDLERS}

templates:
  - kind: ethereum/contract
    name: ArcaidiaLiquidityVault
    network: ${chain.graphNetwork}
    source:
      abi: ArcaidiaLiquidityVault
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.7
      language: wasm/assemblyscript
      file: ./src/vault.ts
      entities: [Intent, Fill, Vault, FeeSnapshot, ProtocolState]
      abis:
        - name: ArcaidiaLiquidityVault
          file: ./abis/ArcaidiaLiquidityVault.json
      eventHandlers:
${VAULT_HANDLERS}
`;
}

// The ABIs the mappings decode against, taken from the same barrel every other
// package uses.
const ABI_FILES = ['ArcaidiaIntentRouter', 'ArcaidiaVaultFactory', 'ArcaidiaLiquidityVault', 'SettlementReceiver'] as const;

function writeAbis(): void {
  mkdirSync(join(SUBGRAPH, 'abis'), { recursive: true });
  for (const name of ABI_FILES) {
    const artifact = JSON.parse(
      readFileSync(join(ROOT, 'contracts', 'out', `${name}.sol`, `${name}.json`), 'utf8'),
    ) as { abi: unknown };
    writeFileSync(join(SUBGRAPH, 'abis', `${name}.json`), `${JSON.stringify(artifact.abi, null, 2)}\n`);
  }
}

function runCli(): void {
  const targets = (Object.keys(CHAINS) as ChainKey[]).map((key) => ({
    key,
    path: join(SUBGRAPH, `subgraph.${key}.yaml`),
    content: manifest(CHAINS[key]),
  }));

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

  console.log(check ? 'Subgraph manifests are up to date.' : `Wrote ${targets.length} manifests and ${ABI_FILES.length} ABIs.`);
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) runCli();
