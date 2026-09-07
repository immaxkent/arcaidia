/**
 * Data access boundary for the whole application.
 *
 * ================= HANDOFF: WIRE THESE FIRST =================
 * Every hook below is a real integration seam. None of them fabricate data:
 * until a source is configured they return `unavailable` (or `empty` when a
 * source exists and genuinely has nothing). Implement them in place — the UI
 * already renders loading / empty / unavailable / error correctly.
 *
 * Sources, per the protocol architecture:
 *   Privy                -> human owner identity + tx signing        (useWalletState)
 *   viem / RPC           -> chain state, balances, allowance, reads   (useUsdcBalance, useVault)
 *   IntentRouter         -> createIntent + IntentCreated              (useIntent)
 *   The Graph            -> intent history, fills, fee/volume aggs    (useIntentHistory, useVaultFills)
 *   Factory / Registry   -> discoverable SolverVaults                 (useVaults)
 *   Solver telemetry     -> heartbeat + pre-chain stages only         (useSolverTelemetry)
 *   Telemetry + chain    -> solver status & realised metrics          (useSolverMetrics)
 *   x402 endpoints       -> market intelligence                       (useMarketIntelligence)
 *
 * Onchain state ALWAYS overrides telemetry once a transaction exists.
 * Telemetry pairing is NOT solver authorisation.
 * ============================================================
 */
export { useWalletState } from "./use-wallet-state";
export { useUsdcBalance, useUsdcAllowance } from "./use-usdc-balance";
export { useIntent, useIntentSettlement, useIntentQuote } from "./use-intent";
export { useIntentHistory } from "./use-intent-history";
export { useVault, useVaults, useVaultAnalytics } from "./use-vaults";
export { useVaultFills, useVaultActivity } from "./use-vault-fills";
export { useSolverTelemetry } from "./use-solver-telemetry";
export { useSolverMetrics } from "./use-solver-metrics";
export { useMarketIntelligence } from "./use-market-intelligence";
export { useOwnedVaults } from "./use-owned-vaults";
