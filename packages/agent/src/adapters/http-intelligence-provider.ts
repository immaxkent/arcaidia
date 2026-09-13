/**
 * `IntelligenceProvider` over HTTP — the relay's `/v1/intelligence/ecosystem` (WP-33), or the
 * paid x402 gateway in front of it (WP-35), which serves the same bytes.
 *
 * Optional by construction: `INTELLIGENCE_URL` unset means no provider and an unchanged solver.
 * With one set, the answer only ever decorates a decision's narrative (see
 * `withIntelligenceNarrative` in process-intent.ts) — it is fetched with a short timeout and a
 * failure is swallowed there, so a slow or dead endpoint can neither delay nor change a fill.
 */
import type { EcosystemIntelligence, IntelligenceProvider, UnixSeconds } from '@arcaidia/domain';

/** The wire shape: bigints travel as decimal strings, `sourceBlocks` values too. */
export interface WireEcosystemIntelligence {
  aggregateAvailableLiquidity: string;
  aggregateUtilisationBps: number;
  feeDistribution: {
    perVault: Array<{ chainId: number; vault: `0x${string}`; utilisationBps: number; currentFeeBps: number; availableLiquidity: string }>;
    minBps: number | null;
    medianBps: number | null;
    maxBps: number | null;
  };
  outstandingIntentVolume: string;
  pendingCctpExposure: string;
  recentFillVelocityPerHour: number | null;
  recentSettlementLatency: { p50Seconds: number | null; p95Seconds: number | null; sampleSize: number };
  liquidityConcentrationBps: number | null;
  estimatedOpportunitySize: string;
  scarcityScoreBps: number;
  window: { fromSeconds: number; toSeconds: number };
  computedAt: number;
  sourceBlocks: Record<string, string>;
}

export function ecosystemFromWire(w: WireEcosystemIntelligence): EcosystemIntelligence {
  return {
    aggregateAvailableLiquidity: BigInt(w.aggregateAvailableLiquidity),
    aggregateUtilisationBps: w.aggregateUtilisationBps,
    feeDistribution: {
      perVault: w.feeDistribution.perVault.map((v) => ({ ...v, availableLiquidity: BigInt(v.availableLiquidity) })),
      minBps: w.feeDistribution.minBps,
      medianBps: w.feeDistribution.medianBps,
      maxBps: w.feeDistribution.maxBps,
    },
    outstandingIntentVolume: BigInt(w.outstandingIntentVolume),
    pendingCctpExposure: BigInt(w.pendingCctpExposure),
    recentFillVelocityPerHour: w.recentFillVelocityPerHour,
    recentSettlementLatency: w.recentSettlementLatency,
    liquidityConcentrationBps: w.liquidityConcentrationBps,
    estimatedOpportunitySize: BigInt(w.estimatedOpportunitySize),
    scarcityScoreBps: w.scarcityScoreBps,
    window: w.window,
    computedAt: w.computedAt,
    sourceBlocks: Object.fromEntries(Object.entries(w.sourceBlocks).map(([chainId, block]) => [Number(chainId), BigInt(block)])),
  };
}

export interface HttpIntelligenceProviderOptions {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
  /** Hard cap on one request; the narrative step must never hold up a fill. */
  readonly timeoutMs?: number;
}

export class HttpIntelligenceProvider implements IntelligenceProvider {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: HttpIntelligenceProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 2_000;
  }

  async ecosystem(_asOf: UnixSeconds): Promise<EcosystemIntelligence> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/intelligence/ecosystem`, {
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Intelligence request failed: ${response.status}`);
    }
    return ecosystemFromWire((await response.json()) as WireEcosystemIntelligence);
  }
}
