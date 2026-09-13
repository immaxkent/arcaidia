/**
 * Ecosystem intelligence (WP-33) — the relay's `/v1/intelligence/chain/{chainId}` view.
 *
 * WIRE: `SERVICES.marketIntelligenceUrl` when set (a separate deployment of the endpoints, or
 * later the paid x402 gateway of WP-35), else the telemetry relay itself, which serves the
 * unpaid endpoints. Nothing here is estimated: every figure is the relay's own number or null,
 * and a relay that cannot answer is `unavailable`, never a zero.
 */
import { useQuery } from "@tanstack/react-query";
import { SERVICES } from "@/lib/arcaidia/config";
import { errorState, readyState, unavailableState, type DataState } from "@/lib/arcaidia/data-state";

export interface MarketIntelligence {
  aggregateLiquidity: bigint | null;
  aggregateUtilisationBps: number | null;
  executableFeeRangeBps: [number, number] | null;
  medianCanonicalLatencySeconds: number | null;
  p95CanonicalLatencySeconds: number | null;
  outstandingSettlementExposure: bigint | null;
  /** The relay's scarcity score, 0 (abundant) – 10 000 (exhausted). */
  congestionScore: number | null;
  /** Not served by any endpoint yet. */
  riskScore: number | null;
  /** Extra context the Liquidity page shows when present. */
  outstandingIntentVolume: bigint | null;
  recentFillVelocityPerHour: number | null;
  estimatedOpportunitySize: bigint | null;
  liquidityConcentrationBps: number | null;
  computedAt: number | null;
}

/** The wire shape: bigints travel as decimal strings. */
interface WireChainIntelligence {
  aggregateAvailableLiquidity: string;
  aggregateUtilisationBps: number;
  feeDistribution: { minBps: number | null; maxBps: number | null };
  outstandingIntentVolume: string;
  pendingCctpExposure: string;
  recentFillVelocityPerHour: number | null;
  recentSettlementLatency: { p50Seconds: number | null; p95Seconds: number | null };
  liquidityConcentrationBps: number | null;
  estimatedOpportunitySize: string;
  scarcityScoreBps: number;
  computedAt: number;
}

export function intelligenceBaseUrl(): string | null {
  return SERVICES.marketIntelligenceUrl ?? SERVICES.solverTelemetryUrl ?? null;
}

export function fromWire(w: WireChainIntelligence): MarketIntelligence {
  return {
    aggregateLiquidity: BigInt(w.aggregateAvailableLiquidity),
    aggregateUtilisationBps: w.aggregateUtilisationBps,
    executableFeeRangeBps: w.feeDistribution.minBps !== null && w.feeDistribution.maxBps !== null ? [w.feeDistribution.minBps, w.feeDistribution.maxBps] : null,
    medianCanonicalLatencySeconds: w.recentSettlementLatency.p50Seconds,
    p95CanonicalLatencySeconds: w.recentSettlementLatency.p95Seconds,
    outstandingSettlementExposure: BigInt(w.pendingCctpExposure),
    congestionScore: w.scarcityScoreBps,
    riskScore: null,
    outstandingIntentVolume: BigInt(w.outstandingIntentVolume),
    recentFillVelocityPerHour: w.recentFillVelocityPerHour,
    estimatedOpportunitySize: BigInt(w.estimatedOpportunitySize),
    liquidityConcentrationBps: w.liquidityConcentrationBps,
    computedAt: w.computedAt,
  };
}

async function fetchChainIntelligence(base: string, chainId: number): Promise<MarketIntelligence> {
  const response = await fetch(`${base.replace(/\/+$/, "")}/v1/intelligence/chain/${chainId}`);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Intelligence request failed: ${response.status}`);
  }
  return fromWire((await response.json()) as WireChainIntelligence);
}

export function useMarketIntelligence(destinationChainId: number): DataState<MarketIntelligence> {
  const base = intelligenceBaseUrl();
  const query = useQuery({
    queryKey: ["market-intelligence", base, destinationChainId],
    queryFn: () => fetchChainIntelligence(base as string, destinationChainId),
    enabled: base !== null,
    refetchInterval: 15_000,
  });

  if (base === null) return unavailableState("Market intelligence service not configured");
  if (query.isError) return errorState(query.error instanceof Error ? query.error.message : "Intelligence request failed");
  if (!query.data) return unavailableState("Loading market intelligence");
  return readyState(query.data);
}

/** WP-35 — the ecosystem-wide view, as the paid gateway and the free relay both serve it. */
export interface EcosystemIntelligenceView {
  aggregateLiquidity: bigint;
  aggregateUtilisationBps: number;
  feeMinBps: number | null;
  feeMedianBps: number | null;
  feeMaxBps: number | null;
  vaultCount: number;
  outstandingIntentVolume: bigint;
  pendingCctpExposure: bigint;
  recentFillVelocityPerHour: number | null;
  p50LatencySeconds: number | null;
  p95LatencySeconds: number | null;
  latencySamples: number;
  scarcityScoreBps: number;
  estimatedOpportunitySize: bigint;
  computedAt: number;
}

interface WireEcosystemIntelligence {
  aggregateAvailableLiquidity: string;
  aggregateUtilisationBps: number;
  feeDistribution: { perVault: unknown[]; minBps: number | null; medianBps: number | null; maxBps: number | null };
  outstandingIntentVolume: string;
  pendingCctpExposure: string;
  recentFillVelocityPerHour: number | null;
  recentSettlementLatency: { p50Seconds: number | null; p95Seconds: number | null; sampleSize: number };
  estimatedOpportunitySize: string;
  scarcityScoreBps: number;
  computedAt: number;
}

export function ecosystemFromWire(w: WireEcosystemIntelligence): EcosystemIntelligenceView {
  return {
    aggregateLiquidity: BigInt(w.aggregateAvailableLiquidity),
    aggregateUtilisationBps: w.aggregateUtilisationBps,
    feeMinBps: w.feeDistribution.minBps,
    feeMedianBps: w.feeDistribution.medianBps,
    feeMaxBps: w.feeDistribution.maxBps,
    vaultCount: w.feeDistribution.perVault.length,
    outstandingIntentVolume: BigInt(w.outstandingIntentVolume),
    pendingCctpExposure: BigInt(w.pendingCctpExposure),
    recentFillVelocityPerHour: w.recentFillVelocityPerHour,
    p50LatencySeconds: w.recentSettlementLatency.p50Seconds,
    p95LatencySeconds: w.recentSettlementLatency.p95Seconds,
    latencySamples: w.recentSettlementLatency.sampleSize,
    scarcityScoreBps: w.scarcityScoreBps,
    estimatedOpportunitySize: BigInt(w.estimatedOpportunitySize),
    computedAt: w.computedAt,
  };
}

export function useEcosystemIntelligence(): DataState<EcosystemIntelligenceView> {
  const base = intelligenceBaseUrl();
  const query = useQuery({
    queryKey: ["ecosystem-intelligence", base],
    enabled: base !== null,
    refetchInterval: 30_000,
    queryFn: async () => {
      const response = await fetch(`${base!.replace(/\/+$/, "")}/v1/intelligence/ecosystem`);
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Intelligence request failed: ${response.status}`);
      }
      return ecosystemFromWire((await response.json()) as WireEcosystemIntelligence);
    },
  });
  if (base === null) return unavailableState("No intelligence endpoint configured (VITE_MARKET_INTELLIGENCE_URL or VITE_SOLVER_TELEMETRY_URL)");
  if (query.isPending) return { status: "loading" };
  if (query.isError) return errorState(query.error.message);
  return readyState(query.data);
}
