/**
 * Discovery and live state, from Arcaidia's shared "Nest" — a self-hosted,
 * unlimited indexer (WP-22), queried over its read-only SQL-over-HTTP surface
 * instead of GraphQL. Same job as `GraphObservationProvider`, same rules,
 * different transport: two chains merged on `intentId`, `observedAt` from the
 * indexer's own freshness signal rather than the local clock, failures throw
 * rather than reporting an empty world. See that file's own doc comment for
 * the reasoning behind each of those — it applies here unchanged.
 *
 * ## The one thing this provider works around
 *
 * The Nest's `pending_intents`/`intents` views return `nonce: null` on every
 * row — confirmed live, 2026-09-11: the raw underlying event table
 * (`intent_router__intent_created`) carries the correct value, so this is a
 * bug in the authored view's column mapping (our best guess: it's reading
 * the `_dec` decimal companion, which the schema's own docs say overflows to
 * NULL above 38 digits — Arcaidia's nonces are full-width random uint256s,
 * so they always overflow). `verify-source.ts` independently re-checks
 * `intent.nonce` against the real onchain event before ever signing a fill —
 * a null nonce here would make every intent fail that check and get quietly
 * declined, indistinguishable from "no work today." Rather than block on the
 * Nest operator fixing the view, `pendingIntents()` fetches `nonce` straight
 * from the raw event table, batched by intentId, the same way `isFilled`
 * checks are batched below. Safe to delete once the view itself is fixed —
 * nothing else here depends on it.
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
import type { NestQueryClient } from './nest-client.js';
import type { EvmContractReadClient } from '../adapters/evm-clients.js';

const VAULT_ABI = ABIS.ArcaidiaLiquidityVault as readonly unknown[];

/** `0x` + 64 hex chars. Validated before any value is interpolated into a SQL string. */
const HEX_32_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export interface NestChainSource {
  readonly chainId: number;
  readonly endpoint: string;
  /** The vault address on this chain, used to key the `vault` view. */
  readonly vault: string;
  /**
   * The settlement asset's own address — the Nest's `vault` view carries no
   * asset column (it doesn't need one; there is exactly one settlement asset
   * per chain, configured in `packages/domain`), so this comes from the
   * caller rather than a query.
   */
  readonly asset: string;
}

export interface SqlNestObservationOptions {
  readonly sources: readonly NestChainSource[];
  readonly client: NestQueryClient;
  /** Vault *config* — see `GraphObservationProvider`'s identical doc comment for why. */
  readonly readClients: ReadonlyMap<number, EvmContractReadClient>;
  readonly clock?: () => UnixSeconds;
}

interface RawPendingIntentRow {
  readonly id: string;
  readonly sender: string;
  readonly recipient: string;
  readonly input_token: string;
  readonly amount: string;
  readonly source_chain_id: string;
  readonly destination_chain_id: string;
  readonly max_fee_bps: string | number;
  readonly deadline: string;
  readonly settlement_ref: string;
  readonly created_at_block: number;
  readonly created_at_timestamp: number;
  readonly created_tx_hash: string;
}

interface RawVaultRow {
  readonly id: string;
  readonly liquid_balance: string;
  readonly outstanding_exposure: string;
  readonly accrued_protocol_fees: string;
  readonly paused: boolean;
  readonly updated_at_block: number;
}

interface RawProtocolStateRow {
  readonly intents_filled: number;
  readonly intents_settled: number;
  readonly oldest_unsettled_timestamp: number;
  readonly pending_settlement_value: string;
}

function sqlInClause(hexValues: readonly string[]): string {
  for (const value of hexValues) {
    if (!HEX_32_PATTERN.test(value)) {
      throw new Error(`Refusing to build a SQL IN-clause from a non-hex32 value: ${value}`);
    }
  }
  return hexValues.map((value) => `'${value.toLowerCase()}'`).join(', ');
}

export class SqlNestObservationProvider implements ObservationProvider {
  private readonly sources: readonly NestChainSource[];
  private readonly client: NestQueryClient;
  private readonly readClients: ReadonlyMap<number, EvmContractReadClient>;
  private readonly clock: () => UnixSeconds;

  constructor(options: SqlNestObservationOptions) {
    this.sources = options.sources;
    this.client = options.client;
    this.readClients = options.readClients;
    this.clock = options.clock ?? (() => Math.floor(Date.now() / 1000));
  }

  /**
   * Pending intents across both chains — see `GraphObservationProvider`'s
   * identical method for why each candidate is checked against the
   * *destination* chain's fills before being offered.
   */
  async pendingIntents(): Promise<readonly Intent[]> {
    const perChain = await Promise.all(
      this.sources.map(async (source) => {
        const result = await this.client.query<RawPendingIntentRow>(
          source.endpoint,
          'SELECT id, sender, recipient, input_token, amount, source_chain_id, destination_chain_id, ' +
            'max_fee_bps, deadline, settlement_ref, created_at_block, created_at_timestamp, created_tx_hash ' +
            'FROM pending_intents ORDER BY created_at_block ASC',
        );
        if (result.truncated) {
          throw new Error(`Nest pending_intents query truncated on ${source.endpoint} — raise the page size.`);
        }
        if (result.degraded) {
          throw new Error(`Nest reports degraded data for pending_intents on ${source.endpoint}.`);
        }
        return { source, rows: result.rows };
      }),
    );

    const allRows = perChain.flatMap(({ rows }) => rows);
    if (allRows.length === 0) return [];

    const nonces = await this.nonceOverride(perChain);
    const candidates = allRows.map((row) => toIntent(row, nonces));

    const filled = await this.filledIntentIds(candidates.map((intent) => intent.intentId));
    return candidates.filter((intent) => !filled.has(intent.intentId));
  }

  /**
   * The nonce workaround (see this file's own doc comment). One batched
   * query per chain, against the raw event table, only for the ids that
   * chain actually returned — never a cross-chain lookup, since an intent's
   * `IntentCreated` event only ever lives on its source chain.
   */
  private async nonceOverride(
    perChain: ReadonlyArray<{ source: NestChainSource; rows: readonly RawPendingIntentRow[] }>,
  ): Promise<Map<string, bigint>> {
    const nonces = new Map<string, bigint>();

    await Promise.all(
      perChain.map(async ({ source, rows }) => {
        if (rows.length === 0) return;
        const ids = rows.map((row) => row.id);
        const result = await this.client.query<{ intentId: string; nonce: string }>(
          source.endpoint,
          `SELECT intentId, nonce FROM intent_router__intent_created WHERE intentId IN (${sqlInClause(ids)})`,
        );
        for (const row of result.rows) nonces.set(row.intentId.toLowerCase(), BigInt(row.nonce));
      }),
    );

    return nonces;
  }

  async vaultState(chainId: number): Promise<VaultState> {
    const source = this.sourceFor(chainId);

    const [result, ready, config] = await Promise.all([
      this.client.query<RawVaultRow>(
        source.endpoint,
        'SELECT id, liquid_balance, outstanding_exposure, accrued_protocol_fees, paused, updated_at_block ' +
          `FROM vault WHERE id = '${source.vault.toLowerCase()}'`,
      ),
      this.client.ready(source.endpoint),
      this.readVaultConfig(chainId, source.vault as `0x${string}`),
    ]);

    const row = result.rows[0];
    if (!row) {
      // An unindexed vault is a broken deployment, not an empty one — same
      // rule GraphObservationProvider already holds.
      throw new Error(`No indexed vault at ${source.vault} on chain ${chainId}.`);
    }

    return {
      chainId,
      vault: row.id as `0x${string}`,
      asset: source.asset as `0x${string}`,
      totalBalance: BigInt(row.liquid_balance),
      totalShares: config.totalShares,
      reserveFloor: config.reserveFloor,
      maxFillAmount: config.maxFillAmount,
      maxOutstandingExposure: config.maxOutstandingExposure,
      outstandingExposure: BigInt(row.outstanding_exposure),
      accruedProtocolFees: BigInt(row.accrued_protocol_fees),
      paused: row.paused,
      blockNumber: BigInt(row.updated_at_block),
      // The Nest's own indexing-head freshness (`/ready`'s last successful
      // poll), not this vault row's own last-mutation timestamp — identical
      // reasoning to GraphObservationProvider's `_meta.block.timestamp` use:
      // a quiet vault is not the same thing as a lagging indexer.
      observedAt: ready.lastPollUnixtime,
    };
  }

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

  async settlementHealth(): Promise<SettlementHealth> {
    const responses = await Promise.all(
      this.sources.map(async (source) => {
        const [result, ready] = await Promise.all([
          this.client.query<RawProtocolStateRow>(
            source.endpoint,
            'SELECT intents_filled, intents_settled, oldest_unsettled_timestamp, pending_settlement_value ' +
              "FROM protocol_state WHERE id = 'arcaidia'",
          ),
          this.client.ready(source.endpoint),
        ]);
        return { row: result.rows[0] ?? null, observedAt: ready.lastPollUnixtime };
      }),
    );

    const present = responses.filter(
      (response): response is { row: RawProtocolStateRow; observedAt: number } => response.row !== null,
    );
    const now = this.clock();

    const pendingValue = present.reduce((sum, { row }) => sum + BigInt(row.pending_settlement_value), 0n);
    const oldestTimestamps = present
      .map(({ row }) => row.oldest_unsettled_timestamp)
      .filter((timestamp) => timestamp > 0);

    return {
      // The Nest answered, so it's reachable. Whether the canonical
      // transport is healthy is the settlement worker's own observation.
      transport: 'HEALTHY',
      oldestUnsettledAgeSeconds:
        oldestTimestamps.length === 0 ? null : now - Math.min(...oldestTimestamps),
      pendingValue,
      averageSettlementLatencySeconds: null,
      latencySampleSize: 0,
      observedAt: Math.min(...responses.map((response) => response.observedAt)),
    };
  }

  /** Whether the destination chain has recorded a fill for this intent — asked of every chain. */
  async isFilled(intentId: Bytes32): Promise<boolean> {
    const filled = await this.filledIntentIds([intentId]);
    return filled.has(intentId);
  }

  /** Batched replacement for calling a per-intent fill check once per candidate. */
  private async filledIntentIds(intentIds: readonly Bytes32[]): Promise<Set<Bytes32>> {
    const ids = [...new Set(intentIds)];
    if (ids.length === 0) return new Set();

    const responses = await Promise.all(
      this.sources.map((source) =>
        this.client.query<{ intent_id: string }>(
          source.endpoint,
          `SELECT intent_id FROM fills WHERE intent_id IN (${sqlInClause(ids)})`,
        ),
      ),
    );

    const filled = new Set<Bytes32>();
    for (const response of responses) {
      for (const row of response.rows) filled.add(row.intent_id.toLowerCase() as Bytes32);
    }
    return filled;
  }

  private sourceFor(chainId: number): NestChainSource {
    const source = this.sources.find((candidate) => candidate.chainId === chainId);
    if (!source) throw new Error(`No Nest endpoint configured for chain ${chainId}.`);
    return source;
  }
}

function toIntent(row: RawPendingIntentRow, nonces: ReadonlyMap<string, bigint>): Intent {
  const nonce = nonces.get(row.id.toLowerCase());
  if (nonce === undefined) {
    throw new Error(`No nonce found for intent ${row.id} via the raw-event-table workaround.`);
  }

  return {
    // The live v1 router emits no trade fields; these are what its event means
    // by construction. Replaced by real columns in WP-27/28.
    ...LEGACY_V1_INTENT_FIELDS,
    intentId: row.id as `0x${string}`,
    sender: row.sender as `0x${string}`,
    recipient: row.recipient as `0x${string}`,
    inputToken: row.input_token as `0x${string}`,
    amount: BigInt(row.amount),
    sourceChainId: Number(row.source_chain_id),
    destinationChainId: Number(row.destination_chain_id),
    maxFeeBps: Number(row.max_fee_bps),
    deadline: Number(row.deadline),
    nonce,
    sourceTxHash: row.created_tx_hash as `0x${string}`,
    sourceBlockNumber: BigInt(row.created_at_block),
    createdAt: row.created_at_timestamp,
    settlementRef: row.settlement_ref as `0x${string}`,
  };
}

export { FastStatus };
