/**
 * Discovery: which intents need canonical settlement tracked, from The Graph.
 *
 * Mirrors `@arcaidia/agent`'s `GraphObservationProvider` in shape and in the
 * two decisions that matter most there, for the same reasons:
 *
 *  - **Failures throw; they never return an empty world.** A provider that
 *    answered "nothing pending" when a subgraph endpoint was down would read
 *    as a quiet day rather than an outage, and settlement would silently stop
 *    advancing while attestations piled up unattended.
 *  - **This discovers work; it authorises nothing.** Every record it returns
 *    still goes through `processSettlement`'s own checks — `isSettled` against
 *    the real receiver before anything else — so a compromised or lying
 *    indexer can stall settlement but cannot forge one.
 *
 * Queries each configured chain as a *source*: an intent's canonical leg is
 * tracked from where it was created, using exactly the fields the router's own
 * `IntentCreated` event already carries (see `CircleCCTPAdapter`'s docstring
 * for why no separate `CircleCCTPInitiator` data source was needed for this).
 */

import type { Address, Bytes32 } from '@arcaidia/domain';
import type { SettlementRecord } from '../worker/ports.js';
import type { GraphQueryClient } from './graph-client.js';

export interface SettlementChainSource {
  readonly chainId: number;
  readonly endpoint: string;
}

export interface GraphSettlementDiscoveryOptions {
  readonly sources: readonly SettlementChainSource[];
  readonly client: GraphQueryClient;
  /** CCTP domain for a chain id. Not derivable from the id — Circle's own allocation. */
  readonly domainFor: (chainId: number) => number;
  /** How many pending settlements to fetch per chain per poll. */
  readonly pageSize?: number;
}

const PENDING_SETTLEMENTS = `
  query PendingSettlements($first: Int!) {
    intents(
      first: $first
      where: { canonicalStatus: PENDING }
      orderBy: createdAtTimestamp
      orderDirection: asc
    ) {
      id recipient amount sourceChainId destinationChainId
      settlementRef createdAtTimestamp createdTxHash
    }
  }`;

interface RawIntent {
  id: string;
  recipient: string;
  amount: string;
  sourceChainId: string;
  destinationChainId: string;
  settlementRef: string;
  createdAtTimestamp: string;
  createdTxHash: string;
}

export interface SettlementDiscoveryProvider {
  /** Every canonically-unsettled intent this provider currently knows about. */
  pendingSettlements(): Promise<readonly SettlementRecord[]>;
}

export class GraphSettlementDiscovery implements SettlementDiscoveryProvider {
  private readonly sources: readonly SettlementChainSource[];
  private readonly client: GraphQueryClient;
  private readonly domainFor: (chainId: number) => number;
  private readonly pageSize: number;

  constructor(options: GraphSettlementDiscoveryOptions) {
    this.sources = options.sources;
    this.client = options.client;
    this.domainFor = options.domainFor;
    this.pageSize = options.pageSize ?? 100;
  }

  async pendingSettlements(): Promise<readonly SettlementRecord[]> {
    const perChain = await Promise.all(
      this.sources.map(async (source) => {
        const data = await this.client.query<{ intents: RawIntent[] }>(
          source.endpoint,
          PENDING_SETTLEMENTS,
          { first: this.pageSize },
        );
        return data.intents.map((raw) => this.toRecord(raw, source));
      }),
    );

    return perChain.flat();
  }

  private toRecord(raw: RawIntent, source: SettlementChainSource): SettlementRecord {
    const sourceChainId = Number(raw.sourceChainId);
    const destinationChainId = Number(raw.destinationChainId);

    return {
      reference: {
        intentId: raw.id as Bytes32,
        sourceChainId,
        destinationChainId,
        sourceDomain: this.domainFor(sourceChainId),
        destinationDomain: this.domainFor(destinationChainId),
        sourceTxHash: raw.createdTxHash as `0x${string}`,
        messageRef: raw.settlementRef as Bytes32,
        initiatedAt: Number(raw.createdAtTimestamp),
      },
      amount: BigInt(raw.amount),
      fallbackRecipient: raw.recipient as Address,
    };
  }
}
