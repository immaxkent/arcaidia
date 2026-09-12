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

import { encodeIntentHook, type Address, type Bytes32 } from '@arcaidia/domain';
import type { SettlementRecord } from '../worker/ports.js';
import type { GraphQueryClient } from './graph-client.js';
import type { NestQueryClient } from './nest-client.js';

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
      intentVersion tokenOut targetMinOut
      settlementRef createdAtTimestamp createdTxHash
    }
  }`;

interface RawIntent {
  id: string;
  recipient: string;
  amount: string;
  sourceChainId: string;
  destinationChainId: string;
  intentVersion?: number | string | null;
  tokenOut?: string | null;
  targetMinOut?: string | null;
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
        // v2 commitments (the router stamps `intentVersion`) carry exactly this hook in
        // their CCTP message (D8); reconstructing it here is what tells the adapter to
        // complete through `settleWithProof`. A v1 row has no version and settles by the
        // reporter path.
        ...(raw.intentVersion !== undefined && raw.intentVersion !== null
          ? { hookData: encodeIntentHook({ intentId: raw.id as Bytes32, recipient: raw.recipient as Address }) }
          : {}),
      },
      amount: BigInt(raw.amount),
      fallbackRecipient: raw.recipient as Address,
    };
  }
}

// ---------------------------------------------------------------------------------------------
// Nest (SQL over HTTP) — the committed default, same rules as the Graph provider above.
// ---------------------------------------------------------------------------------------------

export interface NestSettlementDiscoveryOptions {
  readonly sources: readonly SettlementChainSource[];
  readonly client: NestQueryClient;
  readonly domainFor: (chainId: number) => number;
  readonly pageSize?: number;
}

/** One row of the Nest's `intents` view, the columns this provider selects (snake_case). */
interface RawNestIntent {
  id: string;
  recipient: string;
  amount: string;
  source_chain_id: string | number;
  destination_chain_id: string | number;
  intent_version?: number | string | null;
  token_out?: string | null;
  target_min_out?: string | null;
  settlement_ref: string;
  created_at_timestamp: string | number;
  created_tx_hash: string;
}

/**
 * Same discovery from Arcaidia's shared Nest instead of a GraphQL subgraph: the `intents`
 * view carries the router's `IntentCreated` fields plus `canonical_status`, which is what
 * "needs settlement tracked" means here. Failures throw, truncated or degraded answers throw —
 * a quiet outage must never read as a quiet day.
 */
export class NestSettlementDiscovery implements SettlementDiscoveryProvider {
  private readonly sources: readonly SettlementChainSource[];
  private readonly client: NestQueryClient;
  private readonly domainFor: (chainId: number) => number;
  private readonly pageSize: number;

  constructor(options: NestSettlementDiscoveryOptions) {
    this.sources = options.sources;
    this.client = options.client;
    this.domainFor = options.domainFor;
    this.pageSize = options.pageSize ?? 100;
  }

  async pendingSettlements(): Promise<readonly SettlementRecord[]> {
    const perChain = await Promise.all(
      this.sources.map(async (source) => {
        const result = await this.client.query<RawNestIntent>(
          source.endpoint,
          'SELECT id, recipient, amount, source_chain_id, destination_chain_id, ' +
            'intent_version, token_out, target_min_out, settlement_ref, created_at_timestamp, created_tx_hash ' +
            "FROM intents WHERE canonical_status = 'PENDING' " +
            `ORDER BY created_at_timestamp ASC LIMIT ${this.pageSize}`,
        );
        if (result.truncated) {
          throw new Error(`Nest intents query truncated on ${source.endpoint} — raise the page size.`);
        }
        if (result.degraded) {
          throw new Error(`Nest reports degraded data for intents on ${source.endpoint}.`);
        }
        return result.rows.map((raw) => this.toRecord(raw, source));
      }),
    );
    return perChain.flat();
  }

  private toRecord(raw: RawNestIntent, _source: SettlementChainSource): SettlementRecord {
    const sourceChainId = Number(raw.source_chain_id);
    const destinationChainId = Number(raw.destination_chain_id);
    return {
      reference: {
        intentId: raw.id as Bytes32,
        sourceChainId,
        destinationChainId,
        sourceDomain: this.domainFor(sourceChainId),
        destinationDomain: this.domainFor(destinationChainId),
        sourceTxHash: raw.created_tx_hash as `0x${string}`,
        messageRef: raw.settlement_ref as Bytes32,
        initiatedAt: Number(raw.created_at_timestamp),
        // Same rule as the Graph provider: a versioned (v2) row carries the intent hook (D8)
        // and completes through `settleWithProof`; a v1 row settles by the reporter path.
        ...(raw.intent_version !== undefined && raw.intent_version !== null
          ? { hookData: encodeIntentHook({ intentId: raw.id as Bytes32, recipient: raw.recipient as Address }) }
          : {}),
      },
      amount: BigInt(raw.amount),
      fallbackRecipient: raw.recipient as Address,
    };
  }
}
