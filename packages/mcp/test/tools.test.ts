import { describe, expect, it } from 'vitest';
import { InMemoryObservationProvider } from '@arcaidia/agent';
import type { Intent, SettlementHealth, VaultState } from '@arcaidia/domain';
import { ArcaidiaTools } from '../src/index.js';

const NOW = 1_800_000_000;
const USDC = (whole: number): bigint => BigInt(whole) * 1_000_000n;
const SEPOLIA = 11155111;
const ARC = 5042002;

const CHAIN_NAMES = new Map([
  [SEPOLIA, 'Ethereum'],
  [ARC, 'Arc'],
]);

function vault(overrides: Partial<VaultState> = {}): VaultState {
  return {
    chainId: ARC,
    vault: '0xAAaA000000000000000000000000000000000001',
    asset: '0x3600000000000000000000000000000000000000',
    totalBalance: USDC(100_000),
    totalShares: USDC(100_000),
    reserveFloor: USDC(10_000),
    maxFillAmount: USDC(25_000),
    maxOutstandingExposure: USDC(60_000),
    outstandingExposure: 0n,
    accruedProtocolFees: 0n,
    paused: false,
    feePolicy: {
      baseFeeBps: 10,
      midFeeBps: 25,
      highFeeBps: 60,
      criticalFeeBps: 120,
      midThresholdBps: 5_000,
      highThresholdBps: 7_500,
      criticalThresholdBps: 9_000,
    },
    currentFeeBps: 10,
    blockNumber: 1n,
    observedAt: NOW,
    ...overrides,
  };
}

function health(overrides: Partial<SettlementHealth> = {}): SettlementHealth {
  return {
    transport: 'HEALTHY',
    oldestUnsettledAgeSeconds: null,
    pendingValue: 0n,
    averageSettlementLatencySeconds: null,
    latencySampleSize: 0,
    observedAt: NOW,
    ...overrides,
  };
}

function intent(overrides: Partial<Intent> = {}): Intent {
  return {
    intentVersion: 1,
    tokenOut: '0x0000000000000000000000000000000000000000',
    targetMinOut: 0n,
    intentId: `0x${'ab'.repeat(32)}`,
    sender: '0x1111111111111111111111111111111111111111',
    recipient: '0x2222222222222222222222222222222222222222',
    inputToken: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    amount: USDC(1_000),
    sourceChainId: SEPOLIA,
    destinationChainId: ARC,
    maxFeeBps: 30,
    deadline: NOW + 3_600,
    nonce: 1n,
    sourceTxHash: `0x${'cd'.repeat(32)}`,
    sourceBlockNumber: 100n,
    createdAt: NOW - 45,
    settlementRef: `0x${'ef'.repeat(32)}`,
    ...overrides,
  };
}

function tools(seed: (p: InMemoryObservationProvider) => void = () => {}): ArcaidiaTools {
  const observation = new InMemoryObservationProvider();
  observation.recordVaultState(vault());
  observation.recordSettlementHealth(health());
  seed(observation);

  return new ArcaidiaTools({ observation, chainNames: CHAIN_NAMES, clock: () => NOW });
}

describe('vaultState', () => {
  it('reports formatted figures rather than raw units', async () => {
    const report = await tools().vaultState(ARC);

    expect(report.totalAssets).toBe('100,000.00 USDC');
    expect(report.availableToLend).toBe('90,000.00 USDC');
    expect(report.utilisation).toBe('0.00%');
  });

  it('names the chain rather than reporting an id', async () => {
    expect((await tools().vaultState(ARC)).chain).toBe('Arc');
  });

  it('separates what is advanced from what can be lent', async () => {
    const t = tools((p) =>
      p.recordVaultState(vault({ totalBalance: USDC(60_000), outstandingExposure: USDC(40_000) })),
    );
    const report = await t.vaultState(ARC);

    expect(report.advancedAndAwaitingSettlement).toBe('40,000.00 USDC');
    expect(report.totalAssets).toBe('100,000.00 USDC');
    expect(report.utilisation).toBe('40.00%');
  });

  /// Protocol fees are held by the vault but owed to the treasury. Reporting
  /// them inside LP assets would overstate what liquidity providers own.
  it('reports protocol fees separately from LP assets', async () => {
    const t = tools((p) =>
      p.recordVaultState(vault({ totalBalance: USDC(100_050), accruedProtocolFees: USDC(50) })),
    );
    const report = await t.vaultState(ARC);

    expect(report.protocolFeesOwed).toBe('50.00 USDC');
    expect(report.totalAssets).toBe('100,000.00 USDC');
  });

  /// An answer from a stale indexer is still an answer, but the reader is owed
  /// its age — otherwise the model states old figures as current fact.
  it('surfaces how old the observation is', async () => {
    const t = tools((p) => p.recordVaultState(vault({ observedAt: NOW - 300 })));
    expect((await t.vaultState(ARC)).observationAge).toBe('5m 0s');
  });

  it('says plainly when the vault is paused', async () => {
    const t = tools((p) => p.recordVaultState(vault({ paused: true })));
    const report = await t.vaultState(ARC);

    expect(report.paused).toBe(true);
    expect(report.summary).toContain('paused');
  });

  it('writes a summary a person can read', async () => {
    const report = await tools().vaultState(ARC);
    expect(report.summary).toContain('Arc vault holds 100,000.00 USDC');
    expect(report.summary).toContain('90,000.00 USDC can be advanced');
  });
});

describe('settlementHealth', () => {
  it('reports a quiet system plainly', async () => {
    const report = await tools().settlementHealth();
    expect(report.summary).toContain('Nothing is awaiting canonical settlement');
  });

  it('reports a backlog with its age', async () => {
    const t = tools((p) =>
      p.recordSettlementHealth(
        health({ pendingValue: USDC(45_000), oldestUnsettledAgeSeconds: 900 }),
      ),
    );
    const report = await t.settlementHealth();

    expect(report.pendingValue).toBe('45,000.00 USDC');
    expect(report.oldestUnsettledAge).toBe('15m 0s');
    expect(report.summary).toContain('the oldest for 15m 0s');
  });

  it('passes the transport state through', async () => {
    const t = tools((p) => p.recordSettlementHealth(health({ transport: 'UNAVAILABLE' })));
    expect((await t.settlementHealth()).transport).toBe('UNAVAILABLE');
  });

  it('omits latency it has not observed rather than reporting zero', async () => {
    expect((await tools().settlementHealth()).averageSettlementLatency).toBeNull();
  });
});

describe('pendingIntents', () => {
  it('describes each intent as a route', async () => {
    const t = tools((p) => p.recordIntent(intent()));
    const [report] = await t.pendingIntents();

    expect(report?.route).toBe('Ethereum → Arc');
    expect(report?.amount).toBe('1,000.00 USDC');
    expect(report?.maxFee).toBe('0.30%');
    expect(report?.ageSeconds).toBe(45);
  });

  it('describes the mirrored direction the same way', async () => {
    const t = tools((p) =>
      p.recordIntent(intent({ sourceChainId: ARC, destinationChainId: SEPOLIA })),
    );
    expect((await t.pendingIntents())[0]?.route).toBe('Arc → Ethereum');
  });

  it('returns nothing when there is nothing waiting', async () => {
    expect(await tools().pendingIntents()).toHaveLength(0);
  });
});

describe('intentStatus', () => {
  it('explains an unfilled intent without implying failure', async () => {
    const report = await tools().intentStatus(`0x${'ab'.repeat(32)}`);

    expect(report.filled).toBe(false);
    expect(report.summary).toContain('canonical speed');
  });

  it('explains a filled intent', async () => {
    const i = intent();
    const t = tools((p) => p.markFilled(i.intentId));
    const report = await t.intentStatus(i.intentId);

    expect(report.filled).toBe(true);
    expect(report.summary).toContain('recipient has been paid');
  });
});

describe('the tool surface', () => {
  /// The safety property. A language model with a natural-language interface to
  /// capital is the exact risk this protocol's determinism was designed to
  /// avoid; the server is a window, not a lever.
  it('exposes no method that could move funds or change policy', () => {
    const methods = Object.getOwnPropertyNames(ArcaidiaTools.prototype).filter(
      (name) => name !== 'constructor' && !name.startsWith('#'),
    );

    expect(methods.sort()).toEqual([
      'chainName',
      'ecosystemIntelligence',
      'intentStatus',
      'pendingIntents',
      'settlementHealth',
      'vaultState',
    ]);

    // The verb must start the name and end there — camelCase, so it is
    // followed by a capital or nothing. Matching the bare prefix would flag
    // `settlementHealth` for beginning with "set", which is how the first two
    // attempts at this assertion failed.
    const mutatingVerb = /^(fill|deposit|withdraw|pause|set|sign|submit|transfer|approve|execute|send)([A-Z]|$)/;

    for (const name of methods) {
      expect(name, `${name} reads as a mutation`).not.toMatch(mutatingVerb);
    }

    // And the guard itself works: these would all be caught.
    for (const forbidden of ['setPolicy', 'fillIntent', 'withdrawFees', 'send']) {
      expect(forbidden).toMatch(mutatingVerb);
    }
  });
});

describe('ecosystemIntelligence (WP-33)', () => {
  const view = {
    aggregateAvailableLiquidity: USDC(310) + 500_000n,
    aggregateUtilisationBps: 1_250,
    feeDistribution: {
      perVault: [
        { chainId: ARC, vault: '0xAAaA000000000000000000000000000000000001' as const, utilisationBps: 0, currentFeeBps: 10, availableLiquidity: USDC(108) },
        { chainId: ARC, vault: '0xAAaA000000000000000000000000000000000002' as const, utilisationBps: 0, currentFeeBps: 15, availableLiquidity: USDC(54) },
      ],
      minBps: 10,
      medianBps: 12,
      maxBps: 15,
    },
    outstandingIntentVolume: USDC(3),
    pendingCctpExposure: USDC(4),
    recentFillVelocityPerHour: 1.5,
    recentSettlementLatency: { p50Seconds: 1_200, p95Seconds: 1_500, sampleSize: 3 },
    liquidityConcentrationBps: 3_800,
    estimatedOpportunitySize: USDC(54),
    scarcityScoreBps: 700,
    window: { fromSeconds: NOW - 3_600, toSeconds: NOW },
    computedAt: NOW - 8,
    sourceBlocks: { [ARC]: 1n },
  };

  it('renders the relay view as prose-ready figures', async () => {
    const tools = new ArcaidiaTools({
      observation: new InMemoryObservationProvider(),
      intelligence: { ecosystem: async () => view },
      chainNames: CHAIN_NAMES,
      clock: () => NOW,
    });
    const report = await tools.ecosystemIntelligence();
    expect(report).toMatchObject({ vaults: 2, utilisation: '12.50%', scarcity: '7.00%', fillsPerHour: '1.5', computedAgo: '8s' });
    expect(report.feeRange).toContain('0.10%');
    expect(report.feeRange).toContain('0.15%');
    expect(report.summary).toContain('2 vault(s)');
    expect(report.summary).toContain('scarcity 7.00%');
  });

  it('says so, rather than inventing numbers, when no provider is configured', async () => {
    const tools = new ArcaidiaTools({
      observation: new InMemoryObservationProvider(),
      chainNames: CHAIN_NAMES,
      clock: () => NOW,
    });
    await expect(tools.ecosystemIntelligence()).rejects.toThrow(/not configured/);
  });
});
