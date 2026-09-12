import { describe, expect, it } from 'vitest';
import {
  availableOf,
  computeChain,
  computeEcosystem,
  computeQuoteContext,
  computeVault,
  concentrationBps,
  fillCapacityOf,
  percentile,
  scarcityBps,
  type IntelligenceInputs,
  type VaultRow,
} from '../../src/intelligence/compute.js';

const SEPOLIA = 11_155_111;
const ARC = 5_042_002;
const USDC = (n: number) => BigInt(Math.round(n * 1e6));

function vault(overrides: Partial<VaultRow> & { vault: `0x${string}` }): VaultRow {
  return {
    chainId: ARC,
    liquidBalance: USDC(100),
    outstandingExposure: 0n,
    currentFeeBps: 10,
    reserveFloorBps: 1_000,
    maxFillBps: 5_000,
    maxExposureBps: 9_000,
    paused: false,
    updatedAtBlock: 100n,
    ...overrides,
  };
}

const HOUSE = vault({ vault: `0x${'aa'.repeat(20)}`, liquidBalance: USDC(120), currentFeeBps: 10 });
const B = vault({ vault: `0x${'bb'.repeat(20)}`, liquidBalance: USDC(60), currentFeeBps: 15 });
const C = vault({ vault: `0x${'cc'.repeat(20)}`, liquidBalance: USDC(45), currentFeeBps: 5 });
const SEP_HOUSE = vault({ vault: `0x${'aa'.repeat(20)}`, chainId: SEPOLIA, liquidBalance: USDC(120), currentFeeBps: 10 });

function inputs(overrides: Partial<IntelligenceInputs> = {}): IntelligenceInputs {
  return {
    vaults: [HOUSE, B, C, SEP_HOUSE],
    pendingIntents: [],
    recentFills: [],
    settlementLatencies: [],
    window: { fromSeconds: 1_800_000_000 - 3_600, toSeconds: 1_800_000_000 },
    now: 1_800_000_000,
    sourceBlocks: { [ARC]: 61_736_000n, [SEPOLIA]: 11_690_000n },
    ...overrides,
  };
}

describe('vault arithmetic', () => {
  it('available = liquid minus the reserve floor on total assets, exactly as the vault reports it', () => {
    // 70 liquid + 0 exposure at a 10% floor → 63 available (the live House quote's own figures).
    expect(availableOf(vault({ vault: HOUSE.vault, liquidBalance: USDC(70) }))).toBe(USDC(63));
    // Exposure counts toward the floor's base and never makes available negative.
    expect(availableOf(vault({ vault: HOUSE.vault, liquidBalance: USDC(5), outstandingExposure: USDC(95) }))).toBe(0n);
  });

  it('fill capacity is the tightest of: available, per-fill cap, exposure headroom; zero when paused', () => {
    // 100 liquid: available 90, per-fill 45 (50% of available), headroom 90 → 45.
    expect(fillCapacityOf(vault({ vault: B.vault }))).toBe(USDC(45));
    // Nearly at the exposure cap: 20 liquid + 85 exposure (total 105, cap 94.5) → headroom 9.5, available 9.5, per-fill 4.75.
    expect(fillCapacityOf(vault({ vault: B.vault, liquidBalance: USDC(20), outstandingExposure: USDC(85) }))).toBe(USDC(4.75));
    expect(fillCapacityOf(vault({ vault: B.vault, paused: true }))).toBe(0n);
  });

  it('percentiles use nearest rank and are null on nothing', () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([30, 10, 20], 50)).toBe(20);
    expect(percentile([30, 10, 20, 40], 95)).toBe(40);
  });

  it('concentration is the Herfindahl index over available liquidity, in bps', () => {
    // Two equal vaults → 0.5² + 0.5² = 0.5 → 5000 bps; one vault → 10000; none → null.
    const a = vault({ vault: `0x${'01'.repeat(20)}` });
    const b = vault({ vault: `0x${'02'.repeat(20)}` });
    expect(concentrationBps([a, b])).toBe(5_000);
    expect(concentrationBps([a])).toBe(10_000);
    expect(concentrationBps([])).toBeNull();
  });

  it('scarcity is the bps share of outstanding volume no destination vault could fill at that size', () => {
    // Arc capacities: House 54, B 27, C 20.25 → largest 54.
    const pending = [
      { sourceChainId: SEPOLIA, destinationChainId: ARC, amount: USDC(30), createdAt: 1 },
      { sourceChainId: SEPOLIA, destinationChainId: ARC, amount: USDC(70), createdAt: 2 },
    ];
    expect(scarcityBps([HOUSE, B, C], pending)).toBe(7_000);
    expect(scarcityBps([HOUSE, B, C], [])).toBe(0);
  });
});

describe('computeEcosystem', () => {
  it('aggregates every vault on every chain and reports real-or-null figures', () => {
    const view = computeEcosystem(
      inputs({
        pendingIntents: [{ sourceChainId: SEPOLIA, destinationChainId: ARC, amount: USDC(30), createdAt: 1 }],
        recentFills: [{ chainId: ARC, timestamp: 1_799_999_000 }, { chainId: ARC, timestamp: 1_799_999_500 }],
        settlementLatencies: [{ chainId: ARC, seconds: 600 }, { chainId: ARC, seconds: 900 }, { chainId: ARC, seconds: 1_200 }],
      }),
    );
    // Available: House 108 + B 54 + C 40.5 + Sepolia House 108 = 310.5
    expect(view.aggregateAvailableLiquidity).toBe(USDC(310.5));
    expect(view.aggregateUtilisationBps).toBe(0);
    expect(view.feeDistribution.perVault).toHaveLength(4);
    expect(view.feeDistribution).toMatchObject({ minBps: 5, medianBps: 10, maxBps: 15 });
    expect(view.outstandingIntentVolume).toBe(USDC(30));
    expect(view.pendingCctpExposure).toBe(0n);
    expect(view.recentFillVelocityPerHour).toBe(2);
    expect(view.recentSettlementLatency).toEqual({ p50Seconds: 900, p95Seconds: 1_200, sampleSize: 3 });
    expect(view.estimatedOpportunitySize).toBe(USDC(54));
    expect(view.scarcityScoreBps).toBe(0);
    expect(view.sourceBlocks).toEqual({ [ARC]: 61_736_000n, [SEPOLIA]: 11_690_000n });
    expect(view.computedAt).toBe(1_800_000_000);
  });

  it('with no vaults at all, nothing is invented', () => {
    const view = computeEcosystem(inputs({ vaults: [] }));
    expect(view.aggregateAvailableLiquidity).toBe(0n);
    expect(view.feeDistribution).toEqual({ perVault: [], minBps: null, medianBps: null, maxBps: null });
    expect(view.liquidityConcentrationBps).toBeNull();
    expect(view.recentSettlementLatency).toEqual({ p50Seconds: null, p95Seconds: null, sampleSize: 0 });
  });

  it('ignores paused vaults for the fee distribution but still counts their capital', () => {
    const view = computeEcosystem(inputs({ vaults: [HOUSE, { ...C, paused: true }] }));
    expect(view.feeDistribution).toMatchObject({ minBps: 10, maxBps: 10 });
    expect(view.aggregateAvailableLiquidity).toBe(USDC(148.5));
  });
});

describe('computeChain / computeVault / computeQuoteContext', () => {
  it('scopes to one chain — its vaults, its incoming intents, its fills, its own block', () => {
    const view = computeChain(
      inputs({
        pendingIntents: [
          { sourceChainId: SEPOLIA, destinationChainId: ARC, amount: USDC(30), createdAt: 1 },
          { sourceChainId: ARC, destinationChainId: SEPOLIA, amount: USDC(500), createdAt: 1 },
        ],
      }),
      ARC,
    );
    expect(view.chainId).toBe(ARC);
    expect(view.feeDistribution.perVault.map((v) => v.chainId)).toEqual([ARC, ARC, ARC]);
    expect(view.outstandingIntentVolume).toBe(USDC(30));
    expect(view.sourceBlocks).toEqual({ [ARC]: 61_736_000n });
    // Sepolia's 500 intent against a 54 capacity is fully unfillable there — not Arc's problem.
    expect(computeChain(inputs(), SEPOLIA).scarcityScoreBps).toBe(0);
  });

  it('describes one vault: capacity, share of its chain, fee rank among active peers', () => {
    const view = computeVault(inputs(), ARC, C.vault)!;
    expect(view).toMatchObject({ chainId: ARC, vault: C.vault, currentFeeBps: 5, availableLiquidity: USDC(40.5), fillCapacity: USDC(20.25), paused: false, feeRank: 0 });
    // 40.5 of (108 + 54 + 40.5) = 20%
    expect(view.liquidityShareBps).toBe(2_000);
    expect(computeVault(inputs(), ARC, B.vault)!.feeRank).toBe(2);
    expect(computeVault(inputs(), ARC, `0x${'99'.repeat(20)}`)).toBeNull();
  });

  it('quote context: which vaults could take this size right now, and the fee they post', () => {
    // 30 USDC on Arc: House (54) and B (27)? no — B's capacity is 27 → only House. C is 20.25.
    const thirty = computeQuoteContext(inputs(), USDC(30), ARC);
    expect(thirty).toMatchObject({ vaultsAbleToFill: 1, bestFeeBps: 10, feeRangeBps: [10, 10], estimatedOpportunitySize: USDC(54) });
    // 10 USDC: all three; cheapest is C at 5.
    const ten = computeQuoteContext(inputs(), USDC(10), ARC);
    expect(ten).toMatchObject({ vaultsAbleToFill: 3, bestFeeBps: 5, feeRangeBps: [5, 15] });
    // Nothing can take 500.
    expect(computeQuoteContext(inputs(), USDC(500), ARC)).toMatchObject({ vaultsAbleToFill: 0, bestFeeBps: null, feeRangeBps: null });
  });
});
