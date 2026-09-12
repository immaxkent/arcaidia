/**
 * `pnpm loadgen:start` — real testnet traffic against the live v2 deployment (WP-32).
 *
 * Env:
 *   LOADGEN_USER_KEYS   comma-separated private keys of the user bots (funded with USDC + gas
 *                       on both chains by you). Index them from loadgen.config.json's
 *                       chains[].walletIndices.
 *   LOADGEN_CONFIG      path to the config (default loadgen.config.json)
 *   LOADGEN_DRY_RUN     "true" → plan and journal, send nothing
 *   LOADGEN_TOTAL_SECONDS optional bound; unset = until Ctrl-C
 *   {PREFIX}_RPC_URL    optional RPC overrides, as for the solver
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { CHAINS, deploymentFor, type ChainKey } from '@arcaidia/domain';
import { FetchNestQueryClient } from '@arcaidia/agent';
import { defineChain } from 'viem';
import { sepolia } from 'viem/chains';
import { parseLoadgenConfig } from '../config.js';
import { NestMarketObserver } from '../observe.js';
import { runLoadgen } from '../run.js';
import { DryRunSubmitter, ViemIntentSubmitter, type ChainEndpoint } from '../submit.js';

const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.io'] } },
});

const PREFIX: Record<ChainKey, string> = { 'ethereum-sepolia': 'ETHEREUM_SEPOLIA', 'arc-testnet': 'ARC_TESTNET' };

function endpoints(): Map<number, ChainEndpoint> {
  const map = new Map<number, ChainEndpoint>();
  for (const key of Object.keys(CHAINS) as ChainKey[]) {
    const chain = CHAINS[key];
    const contracts = deploymentFor(key);
    if (!contracts.intentRouter) throw new Error(`${chain.name}: no router in deployments.ts`);
    map.set(chain.chainId, {
      chainId: chain.chainId,
      chain: chain.chainId === 11155111 ? sepolia : arcTestnet,
      rpcUrl: process.env[`${PREFIX[key]}_RPC_URL`] || chain.rpcUrl,
      router: contracts.intentRouter,
      usdc: chain.settlementAsset.address,
    });
  }
  return map;
}

async function main(): Promise<void> {
  const configPath = process.env.LOADGEN_CONFIG ?? 'loadgen.config.json';
  const config = parseLoadgenConfig(JSON.parse(readFileSync(configPath, 'utf8')));
  const dryRun = process.env.LOADGEN_DRY_RUN === 'true';
  const keys = (process.env.LOADGEN_USER_KEYS ?? '').split(',').map((k) => k.trim()).filter(Boolean) as `0x${string}`[];
  if (!dryRun && keys.length === 0) throw new Error('LOADGEN_USER_KEYS is required unless LOADGEN_DRY_RUN=true.');
  const totalSeconds = process.env.LOADGEN_TOTAL_SECONDS ? Number(process.env.LOADGEN_TOTAL_SECONDS) : undefined;

  const submitter = dryRun ? new DryRunSubmitter() : new ViemIntentSubmitter(endpoints(), keys);
  const observer = new NestMarketObserver(
    new FetchNestQueryClient(),
    (Object.keys(CHAINS) as ChainKey[]).map((key) => ({ chainId: CHAINS[key].chainId, endpoint: process.env[`SUBGRAPH_URL_${PREFIX[key]}`] || CHAINS[key].subgraphUrl })),
  );

  let stop = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { console.log(`[loadgen] ${signal}, finishing`); stop = true; });

  console.log(`[loadgen] ${dryRun ? 'DRY RUN' : 'LIVE'} seed=${config.seed} wallets=${keys.length} phases=${config.phases.map((p) => p.kind).join(',')}`);
  const summary = await runLoadgen({
    config,
    submitter,
    observer,
    clock: () => Math.floor(Date.now() / 1000),
    sleep: (s) => new Promise((r) => setTimeout(r, s * 1000)),
    onJournal: (entry) => appendFileSync(config.journalPath, JSON.stringify(entry, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)) + '\n'),
    onMetrics: (m) => writeFileSync(config.metricsPath, JSON.stringify(m, null, 2)),
    log: (line) => console.log(`[loadgen] ${line}`),
    totalSeconds,
    shouldStop: () => stop,
  });
  console.log(`[loadgen] done: ${JSON.stringify(summary)}`);
}

main().catch((error) => {
  console.error('[loadgen] fatal:', error);
  process.exit(1);
});
