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
import { privateKeyToAccount } from 'viem/accounts';
import { arcTestnetChain, ethereumSepoliaChain } from './viem-chains.js';
import {
  CircleCCTPAdapter,
  FetchGraphQueryClient,
  GraphSettlementDiscovery,
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

  const discovery = new GraphSettlementDiscovery({
    sources: config.chains.map((chain) => ({ chainId: chain.chainId, endpoint: chain.subgraphUrl })),
    client: new FetchGraphQueryClient(),
    domainFor: (chainId) => {
      const domain = domainByChainId.get(chainId);
      if (domain === undefined) throw new Error(`No CCTP domain configured for chain ${chainId}.`);
      return domain;
    },
  });

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
