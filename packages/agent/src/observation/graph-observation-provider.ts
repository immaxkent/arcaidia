/**
 * Discovery and live state, from The Graph.
 *
 * Two subgraphs — one per chain — merged on `intentId`, because The Graph has
 * no cross-chain composition primitive and pretending otherwise would hide the
 * per-chain indexing lag that the risk engine is built to react to.
 *
 * ## Two decisions worth knowing
 *
 * **`observedAt` comes from the subgraph, not from the local clock.** A
 * subgraph is a cache that lags. Stamping observations with `Date.now()` would
 * make a subgraph an hour behind look perfectly fresh, and the staleness guard
 * in the risk engine — which exists precisely for this — would never fire.
 *
 * **Failures throw; they never return an empty world.** A provider that
 * answered "no pending intents" when the endpoint was down would be reporting a
 * quiet day rather than an outage, and the solver would idle happily while work
 * piled up. Halting automation is the correct response to losing observation;
 * pretending there is nothing to do is not.
 *
 * This provider discovers work. It never authorises any: `processIntent`
 * independently re-reads the source receipt over RPC before a cent of LP
 * capital moves, so a compromised or lying indexer can stop the system but
 * cannot spend from it.
 */

import {
  ABIS,
  FastStatus,
  LEGACY_V1_INTENT_FIELDS,
  type Bytes32,
  type Intent,
  type ObservationProvider,
  type SettlementHealth,
  type UnixSeconds,
  type VaultState,
} from '@arcaidia/domain';
import type { GraphQueryClient } from './graph-client.js';
import type { EvmContractReadClient } from '../adapters/evm-clients.js';

const VAULT_ABI = ABIS.ArcaidiaLiquidityVault as readonly unknown[];

export interface GraphChainSource {
  readonly chainId: number;
  readonly endpoint: string;
  /** The vault address on this chain, used to key the Vault entity. */
  readonly vault: string;
}

export interface GraphObservationOptions {
  readonly sources: readonly GraphChainSource[];
  readonly client: GraphQueryClient;
  /**
   * Vault *config* — `reserveFloor()`, `maxFillAmount()`, `maxOutstandingExposure()`,
   * `totalSupply()` — is read directly from the chain, keyed by chain id, never
   * from the subgraph: no handler indexes these fields (they only change on the
   * rare `ReserveFloorConfigured`/`FillLimitsConfigured` events), so trusting the
   * subgraph for them would silently serve stale or zeroed values forever. This
   * is exactly the bug that let the agent quote fills the vault would revert.
   */
  readonly readClients: ReadonlyMap<number, EvmContractReadClient>;
  /** How many pending intents to fetch per chain per poll. */
  readonly pageSize?: number;
  /** Local clock, used only for settlement-age arithmetic. */
  readonly clock?: () => UnixSeconds;
}

const PENDING_INTENTS = `
  query PendingIntents($first: Int!) {
    intents(
      first: $first
      where: { fastStatus: PENDING }
      orderBy: createdAtTimestamp
      orderDirection: asc
    ) {
      id sender recipient inputToken amount
      sourceChainId destinationChainId maxFeeBps deadline nonce
      settlementRef createdAtBlock createdAtTimestamp createdTxHash
    }
  }`;

const VAULT_STATE = `
  query VaultState($id: Bytes!) {
    vault(id: $id) {
      id chainId asset liquidBalance outstandingExposure accruedProtocolFees
      paused updatedAtBlock updatedAtTimestamp
    }
    _meta { block { timestamp } }
  }`;

const PROTOCOL_STATE = `
  query ProtocolState {
    protocolState(id: "arcaidia") {
      pendingSettlementValue oldestUnsettledTimestamp
      intentsFilled intentsSettled
    }
    _meta { block { timestamp } }
  }`;

const FILL_FOR_INTENT = `
  query FillForIntent($intentId: Bytes!) {
    fills(first: 1, where: { intentId: $intentId }) { id }
  }`;

/**
 * The batched form of `FILL_FOR_INTENT`, one alias per candidate.
 *
 * `pendingIntents()` used to run one `FILL_FOR_INTENT` query *per candidate
 * per chain* — a quiet poll with a handful of pending intents on a 2s
 * interval (`SOLVER_POLL_INTERVAL_MS`) turns into thousands of subgraph
 * requests an hour, which is what actually exhausts a free-tier daily cap.
 * GraphQL aliases let many lookups travel in one HTTP request instead: this
 * builds one query with `f0`, `f1`, ... aliases, so a poll costs exactly one
 * request per chain regardless of how many candidates it found, not one
 * request per candidate per chain.
 */
function fillsForIntentsQuery(count: number): string {
  const params = Array.from({ length: count }, (_, i) => `$id${i}: Bytes!`).join(', ');
  const fields = Array.from(
    { length: count },
    (_, i) => `f${i}: fills(first: 1, where: { intentId: $id${i} }) { id }`,
  ).join('\n    ');
  return `
  query FillsForIntents(${params}) {
    ${fields}
  }`;
}

interface RawIntent {
  id: string; sender: string; recipient: string; inputToken: string; amount: string;
  sourceChainId: string; destinationChainId: string; maxFeeBps: number;
  deadline: string; nonce: string; settlementRef: string;
  createdAtBlock: string; createdAtTimestamp: string; createdTxHash: string;
}

interface RawVault {
  id: string; chainId: string; asset: string; liquidBalance: string;
  outstandingExposure: string; accruedProtocolFees: string; paused: boolean;
  updatedAtBlock: string; updatedAtTimestamp: string;
}

interface RawProtocolState {
  pendingSettlementValue: string; oldestUnsettledTimestamp: string;
  intentsFilled: string; intentsSettled: string;
}

/**
 * A subgraph's own indexing head — how current its data actually is, right
 * now, independent of any one entity's own activity. This is the correct
 * staleness signal (see `vaultState`/`settlementHealth` below); a specific
 * entity's `updatedAtTimestamp` only tracks indexer lag when that entity is
 * mutated at least as often as the staleness window, which a quiet vault or
 * a quiet settlement queue is not.
 */
interface RawMeta {
  block: { timestamp: string };
}

export class GraphObservationProvider implements ObservationProvider {
  private readonly sources: readonly GraphChainSource[];
  private readonly client: GraphQueryClient;
  private readonly readClients: ReadonlyMap<number, EvmContractReadClient>;
  private readonly pageSize: number;
  private readonly clock: () => UnixSeconds;

  constructor(options: GraphObservationOptions) {
    this.sources = options.sources;
    this.client = options.client;
    this.readClients = options.readClients;
    this.pageSize = options.pageSize ?? 100;
    this.clock = options.clock ?? (() => Math.floor(Date.now() / 1000));
  }

  /**
   * Pending intents across both chains.
   *
   * An intent is created on one chain and filled on the other, so a source
   * subgraph cannot know whether its own intents have been filled. Each
   * candidate is therefore checked against the *destination* chain's fills
   * before being offered — the cross-chain merge, done where the two views meet.
   */
  async pendingIntents(): Promise<readonly Intent[]> {
    const perChain = await Promise.all(
      this.sources.map(async (source) => {
        const data = await this.client.query<{ intents: RawIntent[] }>(
          source.endpoint,
          PENDING_INTENTS,
          { first: this.pageSize },
        );
        return data.intents.map(toIntent);
      }),
    );

    const candidates = perChain.flat();
    if (candidates.length === 0) return [];

    const filled = await this.filledIntentIds(candidates.map((intent) => intent.intentId));
    return candidates.filter((intent) => !filled.has(intent.intentId));
  }

  /**
   * Which of these intent ids already have a fill, on either chain — the
   * batched replacement for calling `isFilled` once per candidate. One
   * aliased request per chain, however many ids are asked about.
   */
  private async filledIntentIds(intentIds: readonly Bytes32[]): Promise<Set<Bytes32>> {
    const ids = [...new Set(intentIds)];
    const document = fillsForIntentsQuery(ids.length);
    const variables = Object.fromEntries(ids.map((id, i) => [`id${i}`, id.toLowerCase()]));

    const responses = await Promise.all(
      this.sources.map((source) =>
        this.client.query<Record<string, Array<{ id: string }>>>(source.endpoint, document, variables),
      ),
    );

    const filled = new Set<Bytes32>();
    for (const response of responses) {
      ids.forEach((id, i) => {
        if ((response[`f${i}`] ?? []).length > 0) filled.add(id);
      });
    }
    return filled;
  }

  async vaultState(chainId: number): Promise<VaultState> {
    const source = this.sourceFor(chainId);

    const [data, config] = await Promise.all([
      this.client.query<{ vault: RawVault | null; _meta: RawMeta }>(source.endpoint, VAULT_STATE, {
        id: source.vault.toLowerCase(),
      }),
      this.readVaultConfig(chainId, source.vault as `0x${string}`),
    ]);

    if (!data.vault) {
      // An unindexed vault is a broken deployment, not an empty one. Reporting
      // zero liquidity would make the solver decline quietly and look like a
      // policy decision.
      throw new Error(`No indexed vault at ${source.vault} on chain ${chainId}.`);
    }

    return {
      chainId,
      vault: data.vault.id as `0x${string}`,
      asset: data.vault.asset as `0x${string}`,
      totalBalance: BigInt(data.vault.liquidBalance),
      totalShares: config.totalShares,
      reserveFloor: config.reserveFloor,
      maxFillAmount: config.maxFillAmount,
      maxOutstandingExposure: config.maxOutstandingExposure,
      outstandingExposure: BigInt(data.vault.outstandingExposure),
      accruedProtocolFees: BigInt(data.vault.accruedProtocolFees),
      paused: data.vault.paused,
      blockNumber: BigInt(data.vault.updatedAtBlock),
      // The subgraph's own indexing head, not this vault's last-mutation
      // timestamp — a quiet vault (no deposits/fills for a while) is not the
      // same thing as a lagging indexer, and conflating them made every quote
      // reject as stale the moment nothing had touched the vault recently.
      observedAt: Number(data._meta.block.timestamp),
    };
  }

  /**
   * Vault config read directly from the chain — see the doc comment on
   * `GraphObservationOptions.readClients` for why the subgraph cannot be
   * trusted for these fields.
   */
  private async readVaultConfig(
    chainId: number,
    vault: `0x${string}`,
  ): Promise<{
    reserveFloor: bigint;
    maxFillAmount: bigint;
    maxOutstandingExposure: bigint;
    totalShares: bigint;
  }> {
    const client = this.readClients.get(chainId);
    if (!client) throw new Error(`No contract read client configured for chain ${chainId}.`);

    const call = (functionName: string) =>
      client.readContract({ address: vault, abi: VAULT_ABI, functionName }) as Promise<bigint>;

    const [reserveFloor, maxFillAmount, maxOutstandingExposure, totalShares] = await Promise.all([
      call('reserveFloor'),
      call('maxFillAmount'),
      call('maxOutstandingExposure'),
      call('totalSupply'),
    ]);

    return { reserveFloor, maxFillAmount, maxOutstandingExposure, totalShares };
  }

  /** Aggregate settlement health across both chains. */
  async settlementHealth(): Promise<SettlementHealth> {
    const responses = await Promise.all(
      this.sources.map((source) =>
        this.client.query<{ protocolState: RawProtocolState | null; _meta: RawMeta }>(
          source.endpoint,
          PROTOCOL_STATE,
        ),
      ),
    );

    const present = responses
      .map((data) => data.protocolState)
      .filter((state): state is RawProtocolState => state !== null);
    // The indexing head, independent of whether protocolState has ever been
    // written — same conflation this provider used to make for vault state
    // (see vaultState's comment above).
    const metaTimestamps = responses.map((data) => Number(data._meta.block.timestamp));
    const now = this.clock();

    const pendingValue = present.reduce(
      (sum, state) => sum + BigInt(state.pendingSettlementValue),
      0n,
    );

    const oldestTimestamps = present
      .map((state) => Number(state.oldestUnsettledTimestamp))
      .filter((timestamp) => timestamp > 0);

    return {
      // The subgraph answered, so the indexer is reachable. Whether the
      // canonical transport is healthy is the settlement worker's observation,
      // not the indexer's — this provider must not claim knowledge it lacks.
      transport: 'HEALTHY',
      oldestUnsettledAgeSeconds:
        oldestTimestamps.length === 0 ? null : now - Math.min(...oldestTimestamps),
      pendingValue,
      averageSettlementLatencySeconds: null,
      latencySampleSize: 0,
      observedAt: Math.min(...metaTimestamps),
    };
  }

  /**
   * Whether the destination chain has recorded a fill for this intent.
   *
   * Asked of every chain, because an intent's destination is not known here
   * without loading it — and a fill on either chain means the same thing.
   */
  async isFilled(intentId: Bytes32): Promise<boolean> {
    const results = await Promise.all(
      this.sources.map((source) =>
        this.client.query<{ fills: Array<{ id: string }> }>(source.endpoint, FILL_FOR_INTENT, {
          intentId: intentId.toLowerCase(),
        }),
      ),
    );

    return results.some((result) => result.fills.length > 0);
  }

  private sourceFor(chainId: number): GraphChainSource {
    const source = this.sources.find((candidate) => candidate.chainId === chainId);
    if (!source) throw new Error(`No subgraph configured for chain ${chainId}.`);
    return source;
  }
}

function toIntent(raw: RawIntent): Intent {
  return {
    // The live v1 router emits no trade fields; these are what its event means
    // by construction. Replaced by real columns in WP-27/28.
    ...LEGACY_V1_INTENT_FIELDS,
    intentId: raw.id as `0x${string}`,
    sender: raw.sender as `0x${string}`,
    recipient: raw.recipient as `0x${string}`,
    inputToken: raw.inputToken as `0x${string}`,
    amount: BigInt(raw.amount),
    sourceChainId: Number(raw.sourceChainId),
    destinationChainId: Number(raw.destinationChainId),
    maxFeeBps: Number(raw.maxFeeBps),
    deadline: Number(raw.deadline),
    nonce: BigInt(raw.nonce),
    sourceTxHash: raw.createdTxHash as `0x${string}`,
    sourceBlockNumber: BigInt(raw.createdAtBlock),
    createdAt: Number(raw.createdAtTimestamp),
    settlementRef: raw.settlementRef as `0x${string}`,
  };
}

export { FastStatus };
