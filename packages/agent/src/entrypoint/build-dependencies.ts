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
import { ABIS, type AgentAuthority } from '@arcaidia/domain';
import { HttpTelemetryClient, NoopTelemetryClient, pairWithRelay, type HeartbeatIntelligence, type TelemetryClient } from '@arcaidia/telemetry';
import { buildReceiptWaiters } from '../adapters/evm-clients.js';
import { HttpIntelligenceProvider } from '../adapters/http-intelligence-provider.js';
import { PaymentLedger, createHederaPayingFetch } from '../adapters/x402-paying-fetch.js';
import { ViemUniswapV2SwapAdapter, type SwapAdapterDeployment } from '../adapters/viem-uniswap-v2-swap-adapter.js';
import { SWAP_INFRASTRUCTURE, type ChainKey } from '@arcaidia/domain';
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
 * Wired for any authority with a personal-sign — the local signer and the Circle Agent
 * Wallet (Circle's `signMessage`) both have one. Pairing needs a plain
 * personal-sign over an arbitrary challenge, which `AgentAuthority` doesn't
 * expose (deliberately — see that port's own doc comment) and Circle's
 * Developer-Controlled Wallets signing surface this codebase talks to is
 * `signTypedData` only. Wiring a Circle-backed pairing signer is real,
 * separate work, not a gap in this call — see `WP-INTENT-MARKET.md` §7's own
 * open question on whether Circle Agent Wallets become mandatory here.
 */
/** Pairing and heartbeats need a personal-sign; both the local signer and the Circle Agent Wallet have one. */
function canSignMessages(authority: AgentAuthority): authority is AgentAuthority & { signMessage(message: string): Promise<`0x${string}`> } {
  return typeof (authority as { signMessage?: unknown }).signMessage === 'function';
}

export function pairAllVaultsInBackground(
  config: SolverEntrypointConfig,
  authority: AgentAuthority,
): void {
  if (!config.telemetry.enabled) return;

  if (!canSignMessages(authority)) {
    console.warn('[telemetry] pairing skipped: this signer cannot personal-sign the relay challenge.');
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
/** The relay keeps pairings in memory: after it restarts, every heartbeat is a 401 until the solver pairs again. */
export const REPAIR_INTERVAL_MS = 2 * 60_000;

/**
 * Re-run pairing on a timer. The relay's pairing table is in-process state, so a relay restart
 * (a redeploy, a crash) silently orphans every solver: heartbeats answer 401 and the vault reads
 * offline until the solver pairs again. Pairing is idempotent on the relay, so repeating it every
 * couple of minutes costs two signed challenges and keeps "online" true through relay restarts.
 */
export function startRepairing(
  config: SolverEntrypointConfig,
  authority: AgentAuthority,
  options: { readonly intervalMs?: number } = {},
): () => void {
  if (!config.telemetry.enabled || !canSignMessages(authority)) return () => {};
  const timer = setInterval(() => pairAllVaultsInBackground(config, authority), options.intervalMs ?? REPAIR_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

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
  options: { readonly intervalMs?: number; readonly clock?: () => number; readonly ledger?: PaymentLedger } = {},
): () => void {
  if (!config.telemetry.enabled || !canSignMessages(authority)) return () => {};
  const clock = options.clock ?? (() => Math.floor(Date.now() / 1000));
  const beat = () => {
    const at = clock();
    const intelligence = heartbeatIntelligence(config, options.ledger);
    for (const chain of config.chains) {
      telemetry.heartbeat({
        chainId: chain.chainId,
        vaultAddress: chain.liquidityVault,
        operatorAddress: authority.address,
        at,
        ...(intelligence ? { intelligence } : {}),
      });
    }
  };
  beat();
  const timer = setInterval(beat, options.intervalMs ?? HEARTBEAT_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

/**
 * WP-35: the free relay endpoint and the paid gateway serve the same bytes; what differs is
 * whether this solver can answer a 402. Without Hedera credentials a paid gateway simply fails
 * (swallowed as narrative, never a fill blocker); with them the answer is bought per request.
 */
export function buildIntelligenceProvider(config: SolverEntrypointConfig, ledger: PaymentLedger = new PaymentLedger()): HttpIntelligenceProvider {
  const baseUrl = config.intelligenceUrl ?? '';
  if (!config.hedera) return new HttpIntelligenceProvider({ baseUrl });
  const paying = createHederaPayingFetch({ accountId: config.hedera.accountId, privateKey: config.hedera.privateKey, ledger });
  return new HttpIntelligenceProvider({ baseUrl, fetchImpl: paying.fetchImpl, ledger: paying.ledger });
}

/**
 * WP-35: what the console's INTEL pill shows. Only present when this solver reads intelligence
 * at all; `paid` says whether it can pay a 402 (Hedera credentials present), and the counters
 * come from the ledger the paying fetch writes.
 */
export function heartbeatIntelligence(config: SolverEntrypointConfig, ledger: PaymentLedger | undefined): HeartbeatIntelligence | null {
  if (!config.intelligenceUrl) return null;
  const summary = ledger?.summary();
  return {
    mode: config.intelligenceMode,
    paid: config.hedera !== null,
    payments: summary?.payments ?? 0,
    totalTinybar: (summary?.totalTinybar ?? 0n).toString(),
    lastTransaction: summary?.last?.transaction ?? null,
    payer: config.hedera?.accountId ?? null,
  };
}

/**
 * WP-34: one `ViemUniswapV2SwapAdapter` over every chain `SWAP_INFRASTRUCTURE` names, reading
 * the deployed adapter contract through the same public clients the vault reads use. A chain
 * with no market simply has no deployment, and `canSatisfy` answers false there.
 */
export function buildSwapAdapter(readClients: ReadonlyMap<number, EvmContractReadClient>): ViemUniswapV2SwapAdapter {
  const deployments = new Map<number, SwapAdapterDeployment>();
  for (const key of Object.keys(SWAP_INFRASTRUCTURE) as ChainKey[]) {
    const infra = SWAP_INFRASTRUCTURE[key];
    const client = infra ? readClients.get(infra.chainId) : undefined;
    if (infra && client) deployments.set(infra.chainId, { address: infra.swapAdapter, client });
  }
  return new ViemUniswapV2SwapAdapter(deployments);
}

/**
 * Reads `isAuthorisedSigner(signer)` on every configured vault now and every `intervalMs`, and
 * answers whether this solver should attempt fills on a destination chain. Unknown (a read that
 * failed) counts as yes: a flaky RPC must not silence a legitimate solver, and an unauthorised
 * attempt only reverts.
 */
export function watchAuthorisedDestinations(
  config: SolverEntrypointConfig,
  signer: `0x${string}`,
  onChange: (chainId: number, authorised: boolean) => void,
  options: { readonly intervalMs?: number; readonly readClients?: ReadonlyMap<number, EvmContractReadClient> } = {},
): { accepts: (chainId: number) => boolean; stop: () => void } {
  const clients = options.readClients ?? buildContractReadClients(config.chains);
  const known = new Map<number, boolean>();
  const refresh = async () => {
    for (const chain of config.chains) {
      const client = clients.get(chain.chainId);
      if (!client) continue;
      try {
        const ok = Boolean(
          await client.readContract({ address: chain.liquidityVault, abi: ABIS.ArcaidiaLiquidityVault, functionName: 'isAuthorisedSigner', args: [signer] }),
        );
        if (known.get(chain.chainId) !== ok) onChange(chain.chainId, ok);
        known.set(chain.chainId, ok);
      } catch {
        // keep the previous answer (or "unknown", which counts as authorised)
      }
    }
  };
  void refresh();
  const timer = setInterval(() => void refresh(), options.intervalMs ?? 5 * 60_000);
  timer.unref?.();
  return { accepts: (chainId) => known.get(chainId) ?? true, stop: () => clearInterval(timer) };
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
  options: { readonly log: DecisionLog; readonly clock?: () => number; readonly ledger?: PaymentLedger },
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
          settlementReceivers: new Map(
            config.chains.flatMap((chain) => (chain.settlementReceivers.length > 0 ? [[chain.chainId, chain.settlementReceivers] as const] : [])),
          ),
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
      intelligence: {
        mode: config.intelligenceMode,
        holdScarcityBps: config.intelligenceHold.scarcityBps,
        holdMarginBps: config.intelligenceHold.marginBps,
      },
    },
    telemetry: buildTelemetryClient(config.telemetry),
    // WP-33/35: absent = the baseline solver, byte for byte. With a URL, the provider reads it;
    // with Hedera credentials too, it pays any 402 it meets over x402 and keeps the receipts.
    ...(config.intelligenceUrl ? { intelligence: buildIntelligenceProvider(config, options.ledger) } : {}),
    // WP-34: the destination market's adapter, read-only; absent = every trade intent declined.
    ...(config.swapAdapterMode === 'uniswap-v2' ? { swapAdapter: buildSwapAdapter(readClients) } : {}),
    // WP-17.1's per-instance vault, now applied where fills are *submitted* too (WP-29).
    vaults: new Map(config.chains.map((chain) => [chain.chainId, chain.liquidityVault])),
  };

  return { deps, signerAddress: authority.address, submitterAddress: submitterAccount.address };
}
