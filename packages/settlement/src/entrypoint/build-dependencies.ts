/**
 * Wires the real adapters behind `SettlementWorkerDependencies` for a live run.
 *
 * Split from `main.ts` so the wiring itself — which client goes with which
 * chain id, which key becomes the reporter — is asserted directly, without
 * needing a live RPC endpoint to do it. Constructing a viem client is a
 * local, lazy operation; nothing here makes a network call.
 *
 * One pair of viem clients per chain serves both roles that need one:
 * `CircleCCTPAdapter` calls `receiveMessage`/`usedNonces` on whichever chain
 * is acting as *destination* for a given settlement, and
 * `ViemSettlementReceiverClient` calls `settle`/`isSettled` on that same
 * chain's `SettlementReceiver` — both are just "the chain id's own read/write
 * client", so one map of each, keyed by chain id, covers both.
 */

import { createPublicClient, createWalletClient, http } from 'viem';
import { CHAINS, allSettlementReceivers, type ChainKey } from '@arcaidia/domain';
import { privateKeyToAccount } from 'viem/accounts';
import { arcTestnetChain, ethereumSepoliaChain } from './viem-chains.js';
import {
  CircleCCTPAdapter,
  FetchGraphQueryClient,
  FetchNestQueryClient,
  GraphSettlementDiscovery,
  NestSettlementDiscovery,
  InMemorySettlementJournal,
  ViemSettlementReceiverClient,
  type ReceiverReadClient,
  type ReceiverWriteClient,
  type SettlementWorkerDependencies,
} from '../index.js';
import type { SettlementEntrypointConfig } from './config.js';

function viemChainFor(chainId: number) {
  if (chainId === ethereumSepoliaChain.id) return ethereumSepoliaChain;
  if (chainId === arcTestnetChain.id) return arcTestnetChain;
  throw new Error(`No viem chain definition for chain ${chainId}.`);
}

/** A read-only client, keyed by chain id — serves both the receiver and the CCTP transport. */
export function buildReadClients(
  chains: SettlementEntrypointConfig['chains'],
): ReadonlyMap<number, ReceiverReadClient> {
  const clients = new Map<number, ReceiverReadClient>();
  for (const chain of chains) {
    clients.set(
      chain.chainId,
      createPublicClient({ chain: viemChainFor(chain.chainId), transport: http(chain.rpcUrl) }),
    );
  }
  return clients;
}

/** A write client per chain, signing as the reporter. */
export function buildWriteClients(
  chains: SettlementEntrypointConfig['chains'],
  reporterPrivateKey: `0x${string}`,
): ReadonlyMap<number, ReceiverWriteClient> {
  const account = privateKeyToAccount(reporterPrivateKey);
  const clients = new Map<number, ReceiverWriteClient>();
  for (const chain of chains) {
    clients.set(
      chain.chainId,
      createWalletClient({ account, chain: viemChainFor(chain.chainId), transport: http(chain.rpcUrl) }),
    );
  }
  return clients;
}

export interface BuiltSettlementDependencies {
  readonly deps: SettlementWorkerDependencies;
  /** The reporter's own address — log it at startup so it's obvious which key is live. */
  readonly reporterAddress: `0x${string}`;
}

const OUTCOME_ABI = [
  { type: 'function', name: 'outcomeOf', stateMutability: 'view', inputs: [{ name: 'intentId', type: 'bytes32' }], outputs: [{ type: 'uint8' }] },
] as const;

/**
 * `outcomeOf(intentId)` on every receiver a chain has had (live, then retired — D12), batched
 * through Multicall3, 100 ids per call. An id is reported only when every receiver answered.
 */
// The read-client map is typed by the narrow ReceiverReadClient; the objects are viem public
// clients, which carry `multicall` when the chain declares Multicall3. Absent = no probe.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MulticallCapable = { multicall?: (...args: any[]) => Promise<readonly { status: string; result?: unknown }[]> };
function outcomeProbeOver(readers: ReadonlyMap<number, MulticallCapable>) {
  return async (chainId: number, intentIds: readonly `0x${string}`[]): Promise<Map<string, number>> => {
    const result = new Map<string, number>();
    const client = readers.get(chainId);
    if (!client?.multicall) return result;
    const key = (Object.keys(CHAINS) as ChainKey[]).find((k) => CHAINS[k].chainId === chainId);
    const receivers = key ? allSettlementReceivers(key) : [];
    if (receivers.length === 0) return result;
    for (let i = 0; i < intentIds.length; i += 100) {
      const slice = intentIds.slice(i, i + 100);
      const answers = await client.multicall({
        allowFailure: true,
        contracts: slice.flatMap((id) => receivers.map((address) => ({ address, abi: OUTCOME_ABI, functionName: 'outcomeOf' as const, args: [id] as const }))),
      });
      slice.forEach((id, j) => {
        const outcomes = receivers.map((_, k) => answers[j * receivers.length + k]);
        if (outcomes.every((a) => a?.status === 'success')) result.set(id.toLowerCase(), Math.max(...outcomes.map((a) => Number(a!.result))));
      });
    }
    return result;
  };
}

export function buildSettlementDependencies(config: SettlementEntrypointConfig): BuiltSettlementDependencies {
  const reporterAccount = privateKeyToAccount(config.reporterPrivateKey);

  const readers = buildReadClients(config.chains);
  const writers = buildWriteClients(config.chains, config.reporterPrivateKey);

  const receivers = new Map(config.chains.map((chain) => [chain.chainId, chain.settlementReceiver]));
  const messageTransmitter = new Map(config.chains.map((chain) => [chain.chainId, chain.messageTransmitter]));
  const domainByChainId = new Map(config.chains.map((chain) => [chain.chainId, chain.domain]));

  const adapter = new CircleCCTPAdapter({
    irisBaseUrl: config.irisBaseUrl,
    messageTransmitter,
    settlementReceivers: receivers,
    readers,
    writers,
  });

  const sources = config.chains.map((chain) => ({ chainId: chain.chainId, endpoint: chain.subgraphUrl }));
  const domainFor = (chainId: number): number => {
    const domain = domainByChainId.get(chainId);
    if (domain === undefined) throw new Error(`No CCTP domain configured for chain ${chainId}.`);
    return domain;
  };
  const discovery =
    config.observationSource === 'graph'
      ? new GraphSettlementDiscovery({ sources, client: new FetchGraphQueryClient(), domainFor })
      : new NestSettlementDiscovery({ sources, client: new FetchNestQueryClient(), domainFor, outcomeProbe: outcomeProbeOver(readers as unknown as ReadonlyMap<number, MulticallCapable>) });

  const deps: SettlementWorkerDependencies = {
    adapter,
    receivers,
    receiverClient: new ViemSettlementReceiverClient(readers, writers),
    journal: new InMemorySettlementJournal(),
    clock: () => Math.floor(Date.now() / 1000),
    discovery,
    registrar: adapter,
  };

  return { deps, reporterAddress: reporterAccount.address };
}
