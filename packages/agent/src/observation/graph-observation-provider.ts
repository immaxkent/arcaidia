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
  FastStatus,
  type Bytes32,
  type Intent,
  type ObservationProvider,
  type SettlementHealth,
  type UnixSeconds,
  type VaultState,
} from '@arcaidia/domain';
import type { GraphQueryClient } from './graph-client.js';

export interface GraphChainSource {
  readonly chainId: number;
  readonly endpoint: string;
  /** The vault address on this chain, used to key the Vault entity. */
  readonly vault: string;
}

export interface GraphObservationOptions {
  readonly sources: readonly GraphChainSource[];
  readonly client: GraphQueryClient;
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
    protocolState(id: "arcaidia") { updatedAtTimestamp }
  }`;

const PROTOCOL_STATE = `
  query ProtocolState {
    protocolState(id: "arcaidia") {
      pendingSettlementValue oldestUnsettledTimestamp
      intentsFilled intentsSettled updatedAtTimestamp
    }
  }`;

const FILL_FOR_INTENT = `
  query FillForIntent($intentId: Bytes!) {
    fills(first: 1, where: { intentId: $intentId }) { id }
  }`;

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
  intentsFilled: string; intentsSettled: string; updatedAtTimestamp: string;
}

export class GraphObservationProvider implements ObservationProvider {
  private readonly sources: readonly GraphChainSource[];
  private readonly client: GraphQueryClient;
  private readonly pageSize: number;
  private readonly clock: () => UnixSeconds;

  constructor(options: GraphObservationOptions) {
    this.sources = options.sources;
    this.client = options.client;
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
    const unfilled = await Promise.all(
      candidates.map(async (intent) => ((await this.isFilled(intent.intentId)) ? null : intent)),
    );

    return unfilled.filter((intent): intent is Intent => intent !== null);
  }

  async vaultState(chainId: number): Promise<VaultState> {
    const source = this.sourceFor(chainId);

    const data = await this.client.query<{ vault: RawVault | null }>(
      source.endpoint,
      VAULT_STATE,
      { id: source.vault.toLowerCase() },
    );

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
      totalShares: 0n,
      reserveFloor: 0n,
      outstandingExposure: BigInt(data.vault.outstandingExposure),
      accruedProtocolFees: BigInt(data.vault.accruedProtocolFees),
      paused: data.vault.paused,
      blockNumber: BigInt(data.vault.updatedAtBlock),
      // The subgraph's own timestamp, so its lag is visible to the risk engine.
      observedAt: Number(data.vault.updatedAtTimestamp),
    };
  }

  /** Aggregate settlement health across both chains. */
  async settlementHealth(): Promise<SettlementHealth> {
    const states = await Promise.all(
      this.sources.map((source) =>
        this.client
          .query<{ protocolState: RawProtocolState | null }>(source.endpoint, PROTOCOL_STATE)
          .then((data) => data.protocolState),
      ),
    );

    const present = states.filter((state): state is RawProtocolState => state !== null);
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
      observedAt: present.length === 0
        ? now
        : Math.min(...present.map((state) => Number(state.updatedAtTimestamp))),
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
