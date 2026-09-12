/**
 * Ecosystem intelligence (WP-33) — the arithmetic, kept pure.
 *
 * Everything here is a function of rows the Nest already serves (`vaults`, `intents`, `fills`,
 * `settlements`). No estimate stands in for missing data: a figure the rows cannot support is
 * `null`, exactly as the frontend's DataState rule and `EcosystemIntelligence`'s own doc demand.
 *
 * Definitions, so the numbers mean one thing everywhere:
 * - available liquidity of a vault = liquid balance minus its reserve floor (the same
 *   `availableLiquidity()` the vault contract reports);
 * - fill capacity of a vault = the largest single fill its own caps admit right now:
 *   min(available × maxFillBps, exposure headroom under maxExposureBps, available), 0 if paused;
 * - opportunity size of a set of vaults = the largest fill capacity among them;
 * - scarcity = the share (bps) of outstanding intent volume that no vault on its destination
 *   chain could fill right now, 0 when nothing is outstanding.
 */
import type {
  Address,
  Bps,
  ChainIntelligence,
  EcosystemIntelligence,
  LatencyPercentiles,
  QuoteContext,
  VaultFeeSnapshot,
  VaultIntelligence,
} from '@arcaidia/domain';

export interface VaultRow {
  readonly chainId: number;
  readonly vault: Address;
  readonly liquidBalance: bigint;
  readonly outstandingExposure: bigint;
  readonly currentFeeBps: Bps;
  readonly reserveFloorBps: Bps;
  readonly maxFillBps: Bps;
  readonly maxExposureBps: Bps;
  readonly paused: boolean;
  readonly updatedAtBlock: bigint;
}

/** An intent created and neither fast-filled nor canonically settled. */
export interface PendingIntentRow {
  readonly sourceChainId: number;
  readonly destinationChainId: number;
  readonly amount: bigint;
  readonly createdAt: number;
}

export interface FillRow {
  readonly chainId: number;
  readonly timestamp: number;
}

export interface IntelligenceInputs {
  readonly vaults: readonly VaultRow[];
  readonly pendingIntents: readonly PendingIntentRow[];
  /** Fills inside the window, on their destination chain. */
  readonly recentFills: readonly FillRow[];
  /** Canonical settlement latencies inside the window, seconds from intent creation, per destination chain. */
  readonly settlementLatencies: readonly { readonly chainId: number; readonly seconds: number }[];
  readonly window: { readonly fromSeconds: number; readonly toSeconds: number };
  readonly now: number;
  readonly sourceBlocks: Readonly<Record<number, bigint>>;
}

const BPS = 10_000n;

function max0(x: bigint): bigint {
  return x < 0n ? 0n : x;
}

export function availableOf(v: VaultRow): bigint {
  const total = v.liquidBalance + v.outstandingExposure;
  return max0(v.liquidBalance - (total * BigInt(v.reserveFloorBps)) / BPS);
}

export function fillCapacityOf(v: VaultRow): bigint {
  if (v.paused) return 0n;
  const available = availableOf(v);
  const total = v.liquidBalance + v.outstandingExposure;
  const perFillCap = (available * BigInt(v.maxFillBps)) / BPS;
  const exposureHeadroom = max0((total * BigInt(v.maxExposureBps)) / BPS - v.outstandingExposure);
  return [available, perFillCap, exposureHeadroom].reduce((a, b) => (a < b ? a : b));
}

function utilisationBps(liquid: bigint, exposure: bigint): Bps {
  const total = liquid + exposure;
  return total === 0n ? 0 : Number((exposure * BPS) / total);
}

/** Nearest-rank percentile over an unsorted sample; null on an empty sample. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1]!;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

function snapshotOf(v: VaultRow): VaultFeeSnapshot {
  return {
    chainId: v.chainId,
    vault: v.vault,
    utilisationBps: utilisationBps(v.liquidBalance, v.outstandingExposure),
    currentFeeBps: v.currentFeeBps,
    availableLiquidity: availableOf(v),
  };
}

function latency(samples: readonly number[]): LatencyPercentiles {
  return { p50Seconds: percentile(samples, 50), p95Seconds: percentile(samples, 95), sampleSize: samples.length };
}

/** Herfindahl index of vault available liquidity, in bps; null with no liquidity at all. */
export function concentrationBps(vaults: readonly VaultRow[]): Bps | null {
  const shares = vaults.map(availableOf);
  const total = shares.reduce((a, b) => a + b, 0n);
  if (total === 0n) return null;
  // Σ share_i² scaled to bps: (a/total)² × 10_000 summed, computed in bigint to keep exactness.
  const hhi = shares.reduce((acc, a) => acc + (a * a * BPS) / (total * total), 0n);
  return Number(hhi);
}

/** Largest single fill any vault in the set could take right now. */
export function opportunitySize(vaults: readonly VaultRow[]): bigint {
  return vaults.map(fillCapacityOf).reduce((a, b) => (a > b ? a : b), 0n);
}

/** Share (bps) of outstanding volume whose destination chain cannot fill it at that size now. */
export function scarcityBps(vaults: readonly VaultRow[], pending: readonly PendingIntentRow[]): Bps {
  if (pending.length === 0) return 0;
  const capacityByChain = new Map<number, bigint>();
  for (const v of vaults) {
    const current = capacityByChain.get(v.chainId) ?? 0n;
    const capacity = fillCapacityOf(v);
    if (capacity > current) capacityByChain.set(v.chainId, capacity);
  }
  let outstanding = 0n;
  let unfillable = 0n;
  for (const intent of pending) {
    outstanding += intent.amount;
    if (intent.amount > (capacityByChain.get(intent.destinationChainId) ?? 0n)) unfillable += intent.amount;
  }
  return outstanding === 0n ? 0 : Number((unfillable * BPS) / outstanding);
}

function computeFor(inputs: IntelligenceInputs, vaults: readonly VaultRow[], pending: readonly PendingIntentRow[], fills: readonly FillRow[], latencies: readonly number[]): EcosystemIntelligence {
  const active = vaults.filter((v) => !v.paused);
  const fees = active.map((v) => v.currentFeeBps);
  const liquid = vaults.reduce((a, v) => a + v.liquidBalance, 0n);
  const exposure = vaults.reduce((a, v) => a + v.outstandingExposure, 0n);
  const windowHours = (inputs.window.toSeconds - inputs.window.fromSeconds) / 3600;
  return {
    aggregateAvailableLiquidity: vaults.reduce((a, v) => a + availableOf(v), 0n),
    aggregateUtilisationBps: utilisationBps(liquid, exposure),
    feeDistribution: {
      perVault: vaults.map(snapshotOf),
      minBps: fees.length ? Math.min(...fees) : null,
      medianBps: median(fees),
      maxBps: fees.length ? Math.max(...fees) : null,
    },
    outstandingIntentVolume: pending.reduce((a, i) => a + i.amount, 0n),
    pendingCctpExposure: exposure,
    recentFillVelocityPerHour: windowHours > 0 ? fills.length / windowHours : null,
    recentSettlementLatency: latency(latencies),
    liquidityConcentrationBps: concentrationBps(vaults),
    estimatedOpportunitySize: opportunitySize(vaults),
    scarcityScoreBps: scarcityBps(vaults, pending),
    window: inputs.window,
    computedAt: inputs.now,
    sourceBlocks: inputs.sourceBlocks,
  };
}

export function computeEcosystem(inputs: IntelligenceInputs): EcosystemIntelligence {
  return computeFor(
    inputs,
    inputs.vaults,
    inputs.pendingIntents,
    inputs.recentFills,
    inputs.settlementLatencies.map((s) => s.seconds),
  );
}

export function computeChain(inputs: IntelligenceInputs, chainId: number): ChainIntelligence {
  const vaults = inputs.vaults.filter((v) => v.chainId === chainId);
  const pending = inputs.pendingIntents.filter((i) => i.destinationChainId === chainId);
  const fills = inputs.recentFills.filter((f) => f.chainId === chainId);
  const latencies = inputs.settlementLatencies.filter((s) => s.chainId === chainId).map((s) => s.seconds);
  const scoped = computeFor(inputs, vaults, pending, fills, latencies);
  const block = inputs.sourceBlocks[chainId];
  return { ...scoped, chainId, sourceBlocks: block === undefined ? {} : { [chainId]: block } };
}

export function computeVault(inputs: IntelligenceInputs, chainId: number, vault: Address): VaultIntelligence | null {
  const row = inputs.vaults.find((v) => v.chainId === chainId && v.vault.toLowerCase() === vault.toLowerCase());
  if (!row) return null;
  const peers = inputs.vaults.filter((v) => v.chainId === chainId);
  const chainAvailable = peers.reduce((a, v) => a + availableOf(v), 0n);
  const available = availableOf(row);
  const cheaperActive = peers.filter((v) => !v.paused && v.currentFeeBps < row.currentFeeBps).length;
  return {
    ...snapshotOf(row),
    outstandingExposure: row.outstandingExposure,
    paused: row.paused,
    fillCapacity: fillCapacityOf(row),
    liquidityShareBps: chainAvailable === 0n ? 0 : Number((available * BPS) / chainAvailable),
    feeRank: cheaperActive,
    computedAt: inputs.now,
  };
}

export function computeQuoteContext(inputs: IntelligenceInputs, amount: bigint, destinationChainId: number): QuoteContext {
  const vaults = inputs.vaults.filter((v) => v.chainId === destinationChainId);
  const able = vaults.filter((v) => fillCapacityOf(v) >= amount && amount > 0n);
  const fees = able.map((v) => v.currentFeeBps);
  return {
    destinationChainId,
    amount,
    vaultsAbleToFill: able.length,
    bestFeeBps: fees.length ? Math.min(...fees) : null,
    feeRangeBps: fees.length ? [Math.min(...fees), Math.max(...fees)] : null,
    estimatedOpportunitySize: opportunitySize(vaults),
    scarcityScoreBps: scarcityBps(
      vaults,
      inputs.pendingIntents.filter((i) => i.destinationChainId === destinationChainId),
    ),
    computedAt: inputs.now,
  };
}
