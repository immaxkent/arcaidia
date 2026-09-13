/**
 * Ecosystem intelligence (WP-33) — the Nest-backed service behind `/v1/intelligence/*`.
 *
 * One fetch feeds every view: the four endpoints are projections of the same `IntelligenceInputs`,
 * cached for `cacheSeconds` so a burst of page loads and solver polls costs the Nest one round
 * of queries. A failed fetch throws — the endpoints answer 503, never a fabricated picture.
 *
 * Settlement latency is the one cross-chain join: a settlement is recorded on the destination
 * chain, the intent it settles was created on the source chain, so each chain's settlements
 * are matched against the *other* chain's `intents` rows by id.
 */
import type { Address, ChainIntelligence, EcosystemIntelligence, QuoteContext, VaultIntelligence } from '@arcaidia/domain';
import type { NestQueryClient } from '../nest-client.js';
import {
  computeChain,
  computeEcosystem,
  computeQuoteContext,
  computeVault,
  type FillRow,
  type IntelligenceInputs,
  type PendingIntentRow,
  type VaultRow,
} from './compute.js';

export interface IntelligenceSource {
  readonly chainId: number;
  readonly endpoint: string;
}

export interface IntelligenceServiceOptions {
  readonly sources: readonly IntelligenceSource[];
  readonly client: NestQueryClient;
  readonly clock?: () => number;
  /** Trailing window for velocity and latency, seconds. */
  readonly windowSeconds?: number;
  readonly cacheSeconds?: number;
}

interface RawVault {
  id: string;
  liquid_balance: string;
  outstanding_exposure: string;
  current_fee_bps: number | string;
  reserve_floor_bps: number | string;
  max_fill_bps: number | string;
  max_exposure_bps: number | string;
  paused: boolean;
  updated_at_block: number | string | null;
}
interface RawPending {
  source_chain_id: number | string;
  destination_chain_id: number | string;
  amount: string;
  created_at_timestamp: number | string;
}
interface RawFill {
  timestamp: number | string;
}
interface RawSettlement {
  intent_id: string;
  timestamp: number | string;
}
interface RawCreated {
  id: string;
  created_at_timestamp: number | string;
}

function inClause(ids: readonly string[]): string {
  return ids.map((id) => `'${id.toLowerCase()}'`).join(', ');
}

export class IntelligenceService {
  private readonly sources: readonly IntelligenceSource[];
  private readonly client: NestQueryClient;
  private readonly clock: () => number;
  private readonly windowSeconds: number;
  private readonly cacheSeconds: number;
  private cached: { at: number; inputs: IntelligenceInputs } | null = null;
  private inflight: Promise<IntelligenceInputs> | null = null;

  constructor(options: IntelligenceServiceOptions) {
    this.sources = options.sources;
    this.client = options.client;
    this.clock = options.clock ?? (() => Math.floor(Date.now() / 1000));
    this.windowSeconds = options.windowSeconds ?? 3_600;
    this.cacheSeconds = options.cacheSeconds ?? 10;
  }

  async ecosystem(): Promise<EcosystemIntelligence> {
    return computeEcosystem(await this.inputs());
  }

  async chain(chainId: number): Promise<ChainIntelligence | null> {
    if (!this.sources.some((s) => s.chainId === chainId)) return null;
    return computeChain(await this.inputs(), chainId);
  }

  async vault(chainId: number, vault: Address): Promise<VaultIntelligence | null> {
    return computeVault(await this.inputs(), chainId, vault);
  }

  async quoteContext(amount: bigint, destinationChainId: number): Promise<QuoteContext | null> {
    if (!this.sources.some((s) => s.chainId === destinationChainId)) return null;
    return computeQuoteContext(await this.inputs(), amount, destinationChainId);
  }

  /** The one cached fetch every view is computed from. */
  async inputs(): Promise<IntelligenceInputs> {
    const now = this.clock();
    if (this.cached && now - this.cached.at < this.cacheSeconds) return this.cached.inputs;
    if (this.inflight) return this.inflight;
    this.inflight = this.fetchInputs(now)
      .then((inputs) => {
        this.cached = { at: now, inputs };
        return inputs;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  private async fetchInputs(now: number): Promise<IntelligenceInputs> {
    const from = now - this.windowSeconds;
    const perChain = await Promise.all(
      this.sources.map(async (source) => {
        const [vaults, pending, fills, settlements] = await Promise.all([
          this.client.query<RawVault>(
            source.endpoint,
            'SELECT id, liquid_balance, outstanding_exposure, current_fee_bps, reserve_floor_bps, max_fill_bps, max_exposure_bps, paused, updated_at_block FROM vaults',
          ),
          this.client.query<RawPending>(
            source.endpoint,
            'SELECT source_chain_id, destination_chain_id, amount, created_at_timestamp FROM intents ' +
              "WHERE fast_status = 'PENDING' AND canonical_status = 'PENDING' ORDER BY created_at_timestamp DESC LIMIT 500",
          ),
          this.client.query<RawFill>(source.endpoint, `SELECT timestamp FROM fills WHERE timestamp >= ${from} LIMIT 5000`),
          this.client.query<RawSettlement>(
            source.endpoint,
            `SELECT intent_id, timestamp FROM settlements WHERE timestamp >= ${from} LIMIT 5000`,
          ),
        ]);
        for (const r of [vaults, pending, fills, settlements]) {
          if (r.degraded) throw new Error(`Nest reports degraded data on ${source.endpoint}.`);
        }
        return { source, vaults: vaults.rows, pending: pending.rows, fills: fills.rows, settlements: settlements.rows };
      }),
    );

    // Latency: each chain's settlements against every *other* chain's intents by id.
    const latencies: { chainId: number; seconds: number }[] = [];
    for (const chain of perChain) {
      if (chain.settlements.length === 0) continue;
      const ids = chain.settlements.map((s) => s.intent_id);
      const createdAt = new Map<string, number>();
      await Promise.all(
        perChain
          .filter((other) => other.source.chainId !== chain.source.chainId)
          .map(async (other) => {
            const result = await this.client.query<RawCreated>(
              other.source.endpoint,
              `SELECT id, created_at_timestamp FROM intents WHERE id IN (${inClause(ids)})`,
            );
            for (const row of result.rows) {
              if (typeof row.id === 'string') createdAt.set(row.id.toLowerCase(), Number(row.created_at_timestamp));
            }
          }),
      );
      for (const s of chain.settlements) {
        const created = createdAt.get(s.intent_id.toLowerCase());
        if (created !== undefined) latencies.push({ chainId: chain.source.chainId, seconds: Number(s.timestamp) - created });
      }
    }

    const vaults: VaultRow[] = perChain.flatMap((c) =>
      c.vaults.map((v) => ({
        chainId: c.source.chainId,
        vault: v.id as Address,
        liquidBalance: BigInt(v.liquid_balance),
        outstandingExposure: BigInt(v.outstanding_exposure),
        currentFeeBps: Number(v.current_fee_bps),
        reserveFloorBps: Number(v.reserve_floor_bps),
        maxFillBps: Number(v.max_fill_bps),
        maxExposureBps: Number(v.max_exposure_bps),
        paused: Boolean(v.paused),
        updatedAtBlock: v.updated_at_block === null ? 0n : BigInt(v.updated_at_block),
      })),
    );
    const pendingIntents: PendingIntentRow[] = perChain.flatMap((c) =>
      c.pending.map((i) => ({
        sourceChainId: Number(i.source_chain_id),
        destinationChainId: Number(i.destination_chain_id),
        amount: BigInt(i.amount),
        createdAt: Number(i.created_at_timestamp),
      })),
    );
    const recentFills: FillRow[] = perChain.flatMap((c) => c.fills.map((f) => ({ chainId: c.source.chainId, timestamp: Number(f.timestamp) })));
    const sourceBlocks: Record<number, bigint> = {};
    for (const c of perChain) {
      sourceBlocks[c.source.chainId] = c.vaults.reduce((m, v) => {
        const b = v.updated_at_block === null ? 0n : BigInt(v.updated_at_block);
        return b > m ? b : m;
      }, 0n);
    }

    return {
      vaults,
      pendingIntents,
      recentFills,
      settlementLatencies: latencies,
      window: { fromSeconds: from, toSeconds: now },
      now,
      sourceBlocks,
    };
  }
}
