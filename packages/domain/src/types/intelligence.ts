/**
 * Ecosystem intelligence — the read-only market picture served by the relay
 * (WP-33) and, later, sold through the Hedera x402 gateway (WP-35). Reserved
 * here in WP-24 so no consumer invents its own shape.
 *
 * Every figure is real or `null` — nothing here is estimated where the
 * underlying data is absent (the app-wide DataState rule).
 */

import type { Address, Bps, UnixSeconds } from './primitives.js';

export interface VaultFeeSnapshot {
  readonly chainId: number;
  readonly vault: Address;
  readonly utilisationBps: Bps;
  readonly currentFeeBps: Bps;
  readonly availableLiquidity: bigint;
}

export interface LatencyPercentiles {
  readonly p50Seconds: number | null;
  readonly p95Seconds: number | null;
  readonly sampleSize: number;
}

export interface EcosystemIntelligence {
  /** Sum of every known vault's deployable USDC, across all chains. */
  readonly aggregateAvailableLiquidity: bigint;
  /** Exposure / (liquidity + exposure), protocol-wide. */
  readonly aggregateUtilisationBps: Bps;
  /** Per-vault posted fees plus the distribution across them. */
  readonly feeDistribution: {
    readonly perVault: readonly VaultFeeSnapshot[];
    readonly minBps: Bps | null;
    readonly medianBps: Bps | null;
    readonly maxBps: Bps | null;
  };
  /** USDC value of intents created and not yet fast-filled or settled. */
  readonly outstandingIntentVolume: bigint;
  /** Principal advanced by vaults and awaiting canonical reimbursement. */
  readonly pendingCctpExposure: bigint;
  /** Fills per hour over the trailing window. */
  readonly recentFillVelocityPerHour: number | null;
  readonly recentSettlementLatency: LatencyPercentiles;
  /** Herfindahl index over vault available liquidity, 0–10_000. */
  readonly liquidityConcentrationBps: Bps | null;
  /** Largest single intent the ecosystem could fast-fill right now. */
  readonly estimatedOpportunitySize: bigint;
  /** 0 (abundant) – 10_000 (exhausted): share of outstanding volume no vault can fill now. */
  readonly scarcityScoreBps: Bps;
  readonly window: { readonly fromSeconds: UnixSeconds; readonly toSeconds: UnixSeconds };
  readonly computedAt: UnixSeconds;
  readonly sourceBlocks: Readonly<Record<number, bigint>>;
}

/** The same picture, scoped to one destination chain — what a solver or a user on that chain sees. */
export interface ChainIntelligence extends EcosystemIntelligence {
  readonly chainId: number;
}

/** One vault's standing in the market right now. */
export interface VaultIntelligence extends VaultFeeSnapshot {
  readonly outstandingExposure: bigint;
  readonly paused: boolean;
  /** Largest single fill this vault could take right now (its own caps applied). */
  readonly fillCapacity: bigint;
  /** This vault's share of its chain's available liquidity, in bps. */
  readonly liquidityShareBps: Bps;
  /** Where its posted fee sits among the chain's active vaults: 0 = cheapest. */
  readonly feeRank: number;
  readonly computedAt: UnixSeconds;
}

/** What a user about to submit `amount` to `destinationChainId` can expect from the market. */
export interface QuoteContext {
  readonly destinationChainId: number;
  readonly amount: bigint;
  /** Vaults on that chain whose caps admit a fill of this size right now. */
  readonly vaultsAbleToFill: number;
  /** The lowest posted fee among those vaults, null when none can fill. */
  readonly bestFeeBps: Bps | null;
  readonly feeRangeBps: readonly [Bps, Bps] | null;
  /** Largest single fill the chain could take right now. */
  readonly estimatedOpportunitySize: bigint;
  readonly scarcityScoreBps: Bps;
  readonly computedAt: UnixSeconds;
}
