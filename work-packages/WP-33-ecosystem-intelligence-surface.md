# WP-33 — Ecosystem intelligence surface (pre-Hedera) (M33)

**Objective:** one clean, real-time, read-only analytics API over both chains — the seam the
Hedera x402 gateway later wraps and the optional solver `IntelligenceProvider` consumes. No
payment, no Hedera, no contract change.

**Depends on:** WP-27 schema (v1 Nest works for a first cut). **Blocks:** WP-35. **Stack:** `packages/relay`.

## Sub-tasks

- [x] **33.1 Types (from WP-24.6)** — plus `ChainIntelligence`, `VaultIntelligence`, `QuoteContext` (2026-09-12). `EcosystemIntelligence`: `aggregateAvailableLiquidity`,
      `aggregateUtilisationBps`, `feeDistribution` (per vault current fee + min/median/max),
      `outstandingIntentVolume`, `pendingCctpExposure`, `recentFillVelocity`,
      `recentSettlementLatency` (p50/p95), `liquidityConcentration` (HHI over vault liquidity),
      `estimatedOpportunitySize`, `scarcityScore`, `computedAt`, `sourceBlocks` per chain.
- [x] **33.2 Relay endpoints** — `packages/relay/src/intelligence/{compute,service}.ts`, routes in `server.ts`, on by default (2026-09-12). (`GET`, CORS open): `/v1/intelligence/ecosystem`,
      `/v1/intelligence/chain/{chainId}`, `/v1/intelligence/vault/{chainId}/{vault}`,
      `/v1/intelligence/quote-context?amount&destinationChainId`. Computed from the Nest via the
      existing `NestQueryClient`, cached 10 s, every number real or `null` (DataState convention).
- [x] **33.3 Consumers.** — web `useMarketIntelligence` → `/v1/intelligence/chain/{id}` (Liquidity page market state); agent `HttpIntelligenceProvider` behind `INTELLIGENCE_URL`; MCP `ecosystemIntelligence` (2026-09-12). `apps/web/use-market-intelligence.ts` wired to these (unpaid);
      `packages/agent` `HttpIntelligenceProvider` (optional; absent = baseline solver);
      `packages/mcp` gains one `ecosystem_intelligence` read-only tool.
- [x] **33.4 x402 readiness notes** — `packages/relay/README.md` (2026-09-12). in the relay README: the endpoints are stateless, idempotent,
      and versioned under `/v1/`; the gateway (WP-35) wraps them with 402 + Hedera payment
      verification without changing their shape.

## Tests

- [x] Pure computation tests over fixture rows (each metric); endpoint tests with `FakeNestClient`;
      solver test proving a failing/absent provider changes no verdict.

## Acceptance gate

`GET /v1/intelligence/ecosystem` returns the full metric set from live Nest data for both chains;
the frontend intelligence panel renders it; the baseline solver runs identically with the
provider unset.
