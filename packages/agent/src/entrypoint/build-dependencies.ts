/**
 * Wires the real adapters behind `SolverDependencies` for a live run.
 *
 * Split from `main.ts` so the wiring itself — which client goes with which
 * chain id, which key becomes the signer vs the submitter — is asserted
 * directly, without needing a live RPC endpoint to do it. Constructing a viem
 * client is a local, lazy operation; nothing here makes a network call.
 */

import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { AgentAuthority } from '@arcaidia/domain';
import { arcTestnetChain, ethereumSepoliaChain } from './viem-chains.js';
import {
  buildCircleSigningClient,
  CircleAgentWalletSigner,
  DEFAULT_RISK_POLICY,
  FetchGraphQueryClient,
  GraphObservationProvider,
  InMemorySubmissionJournal,
  LocalAgentSigner,
  RandomNonceSource,
  ViemFillSubmitter,
  ViemSourceChainReader,
  type DecisionLog,
  type SolverDependencies,
} from '../index.js';
import type { EvmContractReadClient, EvmReadClient, EvmWriteClient } from '../adapters/evm-clients.js';
import type { SolverEntrypointConfig } from './config.js';

/** WP-09: local key or Circle Agent Wallet, chosen by `config.signerAuthority.mode`. */
function buildAuthority(signerAuthority: SolverEntrypointConfig['signerAuthority']): AgentAuthority {
  if (signerAuthority.mode === 'local') {
    return new LocalAgentSigner(signerAuthority.privateKey);
  }
  const client = buildCircleSigningClient({
    apiKey: signerAuthority.apiKey,
    entitySecret: signerAuthority.entitySecret,
  });
  return new CircleAgentWalletSigner(client, signerAuthority.address, signerAuthority.walletId);
}

function viemChainFor(chainId: number) {
  if (chainId === ethereumSepoliaChain.id) return ethereumSepoliaChain;
  if (chainId === arcTestnetChain.id) return arcTestnetChain;
  throw new Error(`No viem chain definition for chain ${chainId}.`);
}

/** A read-only client, keyed by chain id, for source-transaction verification. */
export function buildReadClients(
  chains: SolverEntrypointConfig['chains'],
): ReadonlyMap<number, EvmReadClient> {
  const clients = new Map<number, EvmReadClient>();
  for (const chain of chains) {
    clients.set(
      chain.chainId,
      createPublicClient({ chain: viemChainFor(chain.chainId), transport: http(chain.rpcUrl) }),
    );
  }
  return clients;
}

/**
 * A read-only client per chain for vault *config* — `reserveFloor()`,
 * `maxFillAmount()`, `maxOutstandingExposure()` — which the subgraph never
 * indexes (see `GraphObservationOptions.readClients`). A separate map from
 * `buildReadClients` above: same viem `createPublicClient` call, narrowed to
 * a different structural interface, so each call site only sees the methods
 * it actually uses.
 */
export function buildContractReadClients(
  chains: SolverEntrypointConfig['chains'],
): ReadonlyMap<number, EvmContractReadClient> {
  const clients = new Map<number, EvmContractReadClient>();
  for (const chain of chains) {
    clients.set(
      chain.chainId,
      createPublicClient({ chain: viemChainFor(chain.chainId), transport: http(chain.rpcUrl) }),
    );
  }
  return clients;
}

/** A write client per chain, signing as the submitter — never the signer's own key. */
export function buildWriteClients(
  chains: SolverEntrypointConfig['chains'],
  submitterPrivateKey: `0x${string}`,
): ReadonlyMap<number, EvmWriteClient> {
  const account = privateKeyToAccount(submitterPrivateKey);
  const clients = new Map<number, EvmWriteClient>();
  for (const chain of chains) {
    clients.set(
      chain.chainId,
      createWalletClient({
        account,
        chain: viemChainFor(chain.chainId),
        transport: http(chain.rpcUrl),
      }),
    );
  }
  return clients;
}

function routerMap(chains: SolverEntrypointConfig['chains']) {
  return new Map(chains.map((chain) => [chain.chainId, chain.intentRouter]));
}

export interface BuiltSolverDependencies {
  readonly deps: SolverDependencies;
  /** The signer's own address — log it at startup so it's obvious which key is live. */
  readonly signerAddress: `0x${string}`;
  /** Ditto for the submitter. */
  readonly submitterAddress: `0x${string}`;
}

export function buildSolverDependencies(
  config: SolverEntrypointConfig,
  options: { readonly log: DecisionLog; readonly clock?: () => number },
): BuiltSolverDependencies {
  const authority = buildAuthority(config.signerAuthority);
  const submitterAccount = privateKeyToAccount(config.submitterPrivateKey);

  const observation = new GraphObservationProvider({
    client: new FetchGraphQueryClient(),
    readClients: buildContractReadClients(config.chains),
    sources: config.chains.map((chain) => ({
      chainId: chain.chainId,
      endpoint: chain.subgraphUrl,
      vault: chain.liquidityVault,
    })),
  });

  const deps: SolverDependencies = {
    observation,
    sourceReader: new ViemSourceChainReader(buildReadClients(config.chains), routerMap(config.chains)),
    authority,
    submitter: new ViemFillSubmitter(buildWriteClients(config.chains, config.submitterPrivateKey)),
    log: options.log,
    clock: options.clock ?? (() => Math.floor(Date.now() / 1000)),
    nonces: new RandomNonceSource(),
    journal: new InMemorySubmissionJournal(),
    config: {
      policy: DEFAULT_RISK_POLICY,
      authorizationTtlSeconds: config.authorizationTtlSeconds,
    },
  };

  return { deps, signerAddress: authority.address, submitterAddress: submitterAccount.address };
}
