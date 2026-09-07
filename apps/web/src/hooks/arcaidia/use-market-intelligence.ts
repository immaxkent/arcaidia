/**
 * x402 market intelligence surfaces.
 *
 * WIRE: SERVICES.marketIntelligenceUrl with the published endpoints
 *   /v1/market/{destinationChain}
 *   /v1/settlement/{route}
 *   /v1/risk/{route}
 *   /v1/vaults/{vault}/analytics
 *   /v1/quote-context
 *
 * Nothing here is estimated: aggregate liquidity, settlement percentiles,
 * congestion, risk scores, fee distributions, utilisation and analytics curves
 * are only ever rendered from a real response.
 */
import { SERVICES } from "@/lib/arcaidia/config";
import { unavailableState, type DataState } from "@/lib/arcaidia/data-state";

export interface MarketIntelligence {
  aggregateLiquidity: bigint | null;
  aggregateUtilisationBps: number | null;
  executableFeeRangeBps: [number, number] | null;
  medianCanonicalLatencySeconds: number | null;
  p95CanonicalLatencySeconds: number | null;
  outstandingSettlementExposure: bigint | null;
  congestionScore: number | null;
  riskScore: number | null;
}

export function useMarketIntelligence(destinationChainId: number): DataState<MarketIntelligence> {
  if (!SERVICES.marketIntelligenceUrl) {
    return unavailableState("Market intelligence service not available yet");
  }
  // TODO(integration): fetch `/v1/market/${destinationChainId}` and related endpoints.
  return unavailableState("Market intelligence service not available yet");
}
