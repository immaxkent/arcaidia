/**
 * Static PRODUCT content (roadmap copy, stage labels, solver runtime recipes).
 * This is editorial content, not live protocol data — it is intentionally
 * hardcoded. No progress percentages and no deployment dates are asserted.
 */
import type { SolverStageMeta } from "./types";

export type RoadmapStatus = "SHIPPED" | "BUILDING" | "PLANNED";

export const ROADMAP_STAGES: Array<{
  stage: string;
  status: RoadmapStatus;
  capability: string;
  items: string[];
}> = [
  {
    stage: "V1 — House Fast Settlement",
    status: "SHIPPED",
    capability: "One house vault, a first-party solver agent, and canonical CCTP settlement reimbursing the vault. Frozen as v1.0.0 on 10 September 2026.",
    items: [
      "Arcaidia House Vault on Ethereum Sepolia and Arc Testnet",
      "First-party solver with deterministic, replayable verdicts",
      "Real CCTP V2 burns and mints both directions",
      "The Graph as the discovery and indexing layer",
      "Circle Agent Wallet signs every House fill",
      "Privy sign-in and the transfer flow",
    ],
  },
  {
    stage: "V2 — Intent Market",
    status: "SHIPPED",
    capability: "A permissionless liquidity market: anyone deploys a vault, posts a fee policy, runs the open-source solver, and competes for the first valid fill. Live on both testnets since 12 September 2026.",
    items: [
      "IntentMarket contract: first valid claim wins, enforced on chain",
      "Vault factory with an immutable utilisation-tiered fee policy per vault",
      "Settlement by proof against Circle's attestation, bound to the intent by CCTP hook data",
      "Open-source reference solver, telemetry relay and live console",
      "Self-service vault deployment and solver setup on Earn",
      "Three independent operators and a load generator running around the clock",
    ],
  },
  {
    stage: "V3 — Hedera Agent Economy",
    status: "SHIPPED",
    capability: "Ecosystem intelligence computed from the indexed market and sold per request over x402 on Hedera; the solver buys the view it decides with from its own account.",
    items: [
      "Ecosystem, chain, vault and quote-context intelligence endpoints",
      "x402 paywall on Hedera testnet, settled by the Blocky402 facilitator",
      "Solvers pay per request in HBAR and record the receipt in every decision",
      "Advisory or selective use of the paid view, the policy the operator's to replace",
      "Pay & fetch from the browser on the Intelligence page",
    ],
  },
  {
    stage: "V4 — Uniswap Integration",
    status: "BUILDING",
    capability: "Token-to-token intents: the vault delivers the requested token through a swap adapter on the destination chain, falling back to USDC if the swap cannot meet the floor.",
    items: [
      "Trade intents with a destination token and a minimum output (shipped in the contracts)",
      "Vault-side swap delivery with USDC fallback (shipped in the contracts)",
      "Uniswap v2 adapter wiring on every vault",
      "Trade intents on the Transfer page and in the load generator",
    ],
  },
  {
    stage: "Mainnet Launch",
    status: "PLANNED",
    capability: "The same five contracts on Ethereum and Arc mainnet, behind an audit, staged caps, and execution across every Uniswap generation a destination chain offers.",
    items: [
      "Independent audit, invariant and fuzz testing",
      "Retire the allowlisted-reporter recovery path; permissionless settlement completion",
      "Staged fill and exposure caps, monitoring and alerting",
      "Uniswap v2, v3 and v4 adapters behind one execution interface",
      "Multiple audited fee curves and risk premiums from live settlement data",
    ],
  },
  {
    stage: "Align with Circle and Arc",
    status: "PLANNED",
    capability: "Speculative: shape the product around where Circle and Arc are going, so Arcaidia is the settlement layer their users already expect.",
    items: [
      "Regulatory posture for fast settlement of a regulated stablecoin, per jurisdiction",
      "Fallback mechanisms when CCTP or an attestation service degrades",
      "Native Arc primitives: gateway, paymaster and nanopayment rails as they ship",
      "Circle Wallets as the default user and operator identity",
    ],
  },
  {
    stage: "Super Vaults",
    status: "PLANNED",
    capability: "Vaults that share liquidity: capital pooled across operators and chains to fulfil a settlement no single vault could take alone.",
    items: [
      "Shared liquidity commitments between vaults for one fill",
      "Cross-vault settlement accounting and fee splits",
      "Deeper crosschain liquidity routing and more supported chains",
      "Hedera-side settlement and liquidity",
    ],
  },
];

/**
 * Timeline stage labels. `source` marks whether a stage is informational
 * (solver telemetry) or onchain-confirmed (RPC / contract / The Graph).
 * Onchain stages must never be driven by telemetry.
 */
export const SOLVER_STAGES: SolverStageMeta[] = [
  { id: "INTENT_DISCOVERED", label: "Intent discovered", source: "TELEMETRY" },
  { id: "VERIFYING_SOURCE", label: "Verifying source", source: "TELEMETRY" },
  { id: "FORMULATING_FILL", label: "Formulating fill", source: "TELEMETRY" },
  { id: "SUBMITTING_SETTLEMENT", label: "Submitting fast fill", source: "TELEMETRY" },
  { id: "AWAITING_CONFIRMATION", label: "Awaiting confirmation", source: "ONCHAIN" },
  { id: "FAST_FILL_CONFIRMED", label: "Fast fill confirmed", source: "ONCHAIN" },
  { id: "AWAITING_CANONICAL_SETTLEMENT", label: "Awaiting canonical settlement", source: "ONCHAIN" },
  { id: "SETTLED", label: "Settled", source: "ONCHAIN" },
];

/** Market intelligence endpoints the surfaces will consume once published. */
export const MARKET_INTELLIGENCE_ENDPOINTS = [
  "/v1/market/{destinationChain}",
  "/v1/settlement/{route}",
  "/v1/risk/{route}",
  "/v1/vaults/{vault}/analytics",
  "/v1/quote-context",
];
