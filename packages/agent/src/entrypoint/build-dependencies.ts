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
import { HttpTelemetryClient, NoopTelemetryClient, pairWithRelay, type TelemetryClient } from '@arcaidia/telemetry';
import { buildReceiptWaiters } from '../adapters/evm-clients.js';
import { arcTestnetChain, ethereumSepoliaChain } from './viem-chains.js';
import {
  buildCircleSigningClient,
  CircleAgentWalletSigner,
  DEFAULT_RISK_POLICY,
  FetchGraphQueryClient,
  FetchNestQueryClient,
  GraphObservationProvider,
  InMemorySubmissionJournal,
  LocalAgentSigner,
  RandomNonceSource,
  SqlNestObservationProvider,
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

/** WP-17.2: `TELEMETRY_ENABLED=false` (or unset) is a correct, first-class mode — see
 *  `TelemetryConfig`'s own doc comment for why it isn't defaulted to enabled yet. */
function buildTelemetryClient(config: SolverEntrypointConfig['telemetry']): TelemetryClient {
  if (!config.enabled) return new NoopTelemetryClient();
  return new HttpTelemetryClient({
    relayUrl: config.relayUrl,
    onError: (error, context) => {
      // Never rethrown, never awaited by the caller — see HttpTelemetryClient's own doc
      // comment. Logged so an operator can still notice a persistently unreachable Relay
      // without it ever affecting a single fill.
      console.warn(`[telemetry] ${context} failed:`, error);
    },
  });
}

/**
 * WP-18.1: proves possession of the operator key to the Relay, once per
 * configured chain, so the console can show `TELEMETRY PAIRED` for this
 * vault. Deliberately NOT awaited by its caller (`main.ts`) — this makes a
 * real network call, and pairing is exactly as non-load-bearing as every
 * other telemetry call: a Relay that never responds must never delay, let
 * alone block, the solver actually starting to fill (WP-17.4's own point,
 * one layer up). Every failure is caught and logged here, never thrown.
 *
 * Only wired for `LocalAgentSigner` today: pairing needs a plain
 * personal-sign over an arbitrary challenge, which `AgentAuthority` doesn't
 * expose (deliberately — see that port's own doc comment) and Circle's
 * Developer-Controlled Wallets signing surface this codebase talks to is
 * `signTypedData` only. Wiring a Circle-backed pairing signer is real,
 * separate work, not a gap in this call — see `WP-INTENT-MARKET.md` §7's own
 * open question on whether Circle Agent Wallets become mandatory here.
 */
export function pairAllVaultsInBackground(
  config: SolverEntrypointConfig,
  authority: AgentAuthority,
): void {
  if (!config.telemetry.enabled) return;

  if (!(authority instanceof LocalAgentSigner)) {
    console.warn(
      '[telemetry] pairing skipped: no personal-sign pairing path exists yet for ' +
        `${config.signerAuthority.mode === 'circle' ? 'a Circle Agent Wallet' : 'this signer'}.`,
    );
    return;
  }

  for (const chain of config.chains) {
    void pairWithRelay({
      relayUrl: config.telemetry.relayUrl,
      chainId: chain.chainId,
      vaultAddress: chain.liquidityVault,
      operatorAddress: authority.address,
      signChallenge: (message) => authority.signMessage(message),
    })
      .then(() => console.log(`[telemetry] paired chain ${chain.chainId}, vault ${chain.liquidityVault}`))
      .catch((error: unknown) => console.warn(`[telemetry] pairing failed for chain ${chain.chainId}:`, error));
  }
}

/** Relay sweeps a paired operator to offline after 30s of silence; a third of that keeps it live. */
export const HEARTBEAT_INTERVAL_MS = 10_000;

/**
 * WP-18.2: the "solver online" fact. A heartbeat says one thing — this process is still
 * running for this vault — so it is sent on its own clock, whether or not the last pass
 * found anything (an observation source being down is exactly when the operator wants to
 * see that the solver itself is still up). Same guard as pairing: only a locally-held
 * signer can have paired, and an unpaired heartbeat is a 401 the relay would log every tick.
 *
 * Returns the stop function; never throws — `HttpTelemetryClient` swallows delivery errors.
 */
export function startHeartbeats(
  config: SolverEntrypointConfig,
  authority: AgentAuthority,
  telemetry: TelemetryClient,
  options: { readonly intervalMs?: number; readonly clock?: () => number } = {},
): () => void {
  if (!config.telemetry.enabled || !(authority instanceof LocalAgentSigner)) return () => {};
  const clock = options.clock ?? (() => Math.floor(Date.now() / 1000));
  const beat = () => {
    const at = clock();
    for (const chain of config.chains) {
      telemetry.heartbeat({
        chainId: chain.chainId,
        vaultAddress: chain.liquidityVault,
        operatorAddress: authority.address,
        at,
      });
    }
  };
  beat();
  const timer = setInterval(beat, options.intervalMs ?? HEARTBEAT_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
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

  // WP-22: Arcaidia's shared, unlimited indexer by default — see
  // ChainEntrypointConfig.subgraphUrl's own doc comment for the override.
  // WP-31: OBSERVATION_SOURCE=graph reads GraphQL subgraphs instead (Subgraph Studio), the
  // contingency for the window before a Nest is re-seeded for a new deployment.
  const readClients = buildContractReadClients(config.chains);
  const observation =
    config.observationSource === 'graph'
      ? new GraphObservationProvider({
          client: new FetchGraphQueryClient(),
          readClients,
          sources: config.chains.map((chain) => ({
            chainId: chain.chainId,
            endpoint: chain.subgraphUrl,
            vault: chain.liquidityVault,
          })),
        })
      : new SqlNestObservationProvider({
          client: new FetchNestQueryClient(),
          readClients,
          sources: config.chains.map((chain) => ({
            chainId: chain.chainId,
            endpoint: chain.subgraphUrl,
            vault: chain.liquidityVault,
            asset: chain.asset,
          })),
        });

  const deps: SolverDependencies = {
    observation,
    sourceReader: new ViemSourceChainReader(buildReadClients(config.chains), routerMap(config.chains)),
    authority,
    submitter: new ViemFillSubmitter(
      buildWriteClients(config.chains, config.submitterPrivateKey),
      buildReceiptWaiters(config.chains, (chainId, rpcUrl) =>
        createPublicClient({ chain: viemChainFor(chainId), transport: http(rpcUrl) }),
      ),
    ),
    log: options.log,
    clock: options.clock ?? (() => Math.floor(Date.now() / 1000)),
    nonces: new RandomNonceSource(),
    journal: new InMemorySubmissionJournal(),
    config: {
      policy: DEFAULT_RISK_POLICY,
      authorizationTtlSeconds: config.authorizationTtlSeconds,
    },
    telemetry: buildTelemetryClient(config.telemetry),
    // WP-17.1's per-instance vault, now applied where fills are *submitted* too (WP-29).
    vaults: new Map(config.chains.map((chain) => [chain.chainId, chain.liquidityVault])),
  };

  return { deps, signerAddress: authority.address, submitterAddress: submitterAccount.address };
}
