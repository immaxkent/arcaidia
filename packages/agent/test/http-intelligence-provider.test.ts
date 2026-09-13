import { describe, expect, it } from 'vitest';
import { HttpIntelligenceProvider, type WireEcosystemIntelligence } from '../src/index.js';

const WIRE: WireEcosystemIntelligence = {
  aggregateAvailableLiquidity: '310500000',
  aggregateUtilisationBps: 0,
  feeDistribution: {
    perVault: [{ chainId: 5_042_002, vault: `0x${'bb'.repeat(20)}`, utilisationBps: 0, currentFeeBps: 15, availableLiquidity: '54000000' }],
    minBps: 5,
    medianBps: 10,
    maxBps: 15,
  },
  outstandingIntentVolume: '3780000',
  pendingCctpExposure: '0',
  recentFillVelocityPerHour: 1,
  recentSettlementLatency: { p50Seconds: 1200, p95Seconds: 1200, sampleSize: 1 },
  liquidityConcentrationBps: 3_800,
  estimatedOpportunitySize: '54000000',
  scarcityScoreBps: 0,
  window: { fromSeconds: 1, toSeconds: 3601 },
  computedAt: 3601,
  sourceBlocks: { '5042002': '61736000', '11155111': '11690000' },
};

describe('HttpIntelligenceProvider', () => {
  it('fetches /v1/intelligence/ecosystem and restores the bigints', async () => {
    const calls: string[] = [];
    const provider = new HttpIntelligenceProvider({
      baseUrl: 'https://relay.example/',
      fetchImpl: (async (url: string) => {
        calls.push(url);
        return new Response(JSON.stringify(WIRE), { status: 200 });
      }) as unknown as typeof fetch,
    });
    const view = await provider.ecosystem(3601);
    expect(calls).toEqual(['https://relay.example/v1/intelligence/ecosystem']);
    expect(view.aggregateAvailableLiquidity).toBe(310_500_000n);
    expect(view.feeDistribution.perVault[0]!.availableLiquidity).toBe(54_000_000n);
    expect(view.sourceBlocks).toEqual({ 5_042_002: 61_736_000n, 11_155_111: 11_690_000n });
    expect(view.scarcityScoreBps).toBe(0);
  });

  it("throws with the relay's reason on a non-200, so the narrative step can swallow it", async () => {
    const provider = new HttpIntelligenceProvider({
      baseUrl: 'https://relay.example',
      fetchImpl: (async () => new Response(JSON.stringify({ error: 'Intelligence unavailable: nest down' }), { status: 503 })) as unknown as typeof fetch,
    });
    await expect(provider.ecosystem(1)).rejects.toThrow('nest down');
  });
});
