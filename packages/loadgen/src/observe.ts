/**
 * What the generator can see of the market — read from the Nest, the same source the
 * frontend and the intelligence surface (WP-33) use, so every number this process logs is
 * one a judge can reproduce with a SELECT. Everything degrades to null when a view is absent.
 */
export interface NestLike {
  query<T>(endpoint: string, sql: string): Promise<{ rows: readonly T[] }>;
}

export interface VaultSnapshot {
  readonly chainId: number;
  readonly vault: string;
  readonly liquidBalance: bigint;
  readonly outstandingExposure: bigint;
  readonly accruedProtocolFees: bigint;
  readonly reserveFloorBps: number;
  readonly currentFeeBps: number | null;
  readonly utilisationBps: number | null;
}

export interface MarketSnapshot {
  readonly at: number;
  readonly vaults: readonly VaultSnapshot[];
  /** Sum over vaults of (LP cash − reserve floor), the capital a fast fill can draw on. */
  readonly aggregateAvailableLiquidity: bigint | null;
  readonly aggregateOutstandingExposure: bigint | null;
  readonly intentsCreated: number | null;
  readonly intentsFilled: number | null;
  readonly intentsFallenBack: number | null;
}

export interface MarketObserver {
  snapshot(): Promise<MarketSnapshot>;
}

interface RawVault {
  id: string; liquid_balance: string; outstanding_exposure: string; accrued_protocol_fees: string;
  reserve_floor_bps: number | string; current_fee_bps: number | string | null; utilisation_bps: number | string | null;
}
interface RawProtocolState { intents_created: string | number; intents_filled: string | number; intents_fallen_back: string | number | null }

export class NestMarketObserver implements MarketObserver {
  constructor(
    private readonly nest: NestLike,
    private readonly sources: readonly { chainId: number; endpoint: string }[],
    private readonly clock: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  async snapshot(): Promise<MarketSnapshot> {
    const vaults: VaultSnapshot[] = [];
    let created = 0, filled = 0, fallen = 0, haveState = false, haveVaults = false;

    for (const source of this.sources) {
      try {
        const result = await this.nest.query<RawVault>(
          source.endpoint,
          'SELECT id, liquid_balance, outstanding_exposure, accrued_protocol_fees, reserve_floor_bps, current_fee_bps, utilisation_bps FROM vaults',
        );
        haveVaults = true;
        for (const r of result.rows) {
          vaults.push({
            chainId: source.chainId,
            vault: r.id,
            liquidBalance: BigInt(r.liquid_balance),
            outstandingExposure: BigInt(r.outstanding_exposure),
            accruedProtocolFees: BigInt(r.accrued_protocol_fees),
            reserveFloorBps: Number(r.reserve_floor_bps),
            currentFeeBps: r.current_fee_bps === null ? null : Number(r.current_fee_bps),
            utilisationBps: r.utilisation_bps === null ? null : Number(r.utilisation_bps),
          });
        }
      } catch {
        // Not re-seeded yet or unreachable — leave this chain's vaults out rather than guess.
      }
      try {
        const state = await this.nest.query<RawProtocolState>(
          source.endpoint,
          "SELECT intents_created, intents_filled, intents_fallen_back FROM protocol_state WHERE id = 'arcaidia'",
        );
        const row = state.rows[0];
        if (row) {
          haveState = true;
          created += Number(row.intents_created);
          filled += Number(row.intents_filled);
          fallen += Number(row.intents_fallen_back ?? 0);
        }
      } catch {
        /* same */
      }
    }

    const available = haveVaults
      ? vaults.reduce((sum, v) => {
          const lpCash = v.liquidBalance - v.accruedProtocolFees;
          const total = (lpCash > 0n ? lpCash : 0n) + v.outstandingExposure;
          const floor = (total * BigInt(v.reserveFloorBps) + 9_999n) / 10_000n;
          return sum + (lpCash > floor ? lpCash - floor : 0n);
        }, 0n)
      : null;

    return {
      at: this.clock(),
      vaults,
      aggregateAvailableLiquidity: available,
      aggregateOutstandingExposure: haveVaults ? vaults.reduce((s, v) => s + v.outstandingExposure, 0n) : null,
      intentsCreated: haveState ? created : null,
      intentsFilled: haveState ? filled : null,
      intentsFallenBack: haveState ? fallen : null,
    };
  }
}
