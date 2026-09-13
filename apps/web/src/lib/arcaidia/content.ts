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
    stage: "Intent Market",
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
    stage: "Agent Economy — Hedera x402",
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
    stage: "V2 — Uniswap Integration",
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
    stage: "Pricing Evolution",
    status: "PLANNED",
    capability: "More than one audited way to price risk and allocate capital, beyond the utilisation-tiered policy vaults post today.",
    items: ["Multiple audited fee curves", "Risk premiums from settlement latency and exposure", "Capital allocation strategies across chains"],
  },
  {
    stage: "Trust Minimisation",
    status: "PLANNED",
    capability: "Fewer privileged roles and a settlement path anyone can complete without an operator's help.",
    items: [
      "Retire the allowlisted-reporter recovery path",
      "Permissionless settlement completion from any relayer",
      "Formalised solver and vault interfaces",
      "Reduced owner powers on live vaults",
    ],
  },
  {
    stage: "Network Expansion",
    status: "PLANNED",
    capability: "More supported chains and deeper crosschain routing, including settlement and liquidity beyond EVM.",
    items: ["Additional supported EVM chains", "Hedera-side settlement and liquidity", "Cross-ecosystem intent routing"],
  },
  {
    stage: "Security",
    status: "PLANNED",
    capability: "Independent review plus staged exposure limits before real capital.",
    items: ["Independent audit", "Invariant and fuzz testing", "Monitoring and alerting", "Staged caps"],
  },
];
}> = [
  {
    stage: "V1 — House Fast Settlement",
    status: "BUILDING",
    capability: "Arcaidia house vault with a first-party solver agent and CCTP-first fast settlement.",
    items: [
      "Arcaidia House Vault on Ethereum and Arc",
      "First-party solver agent with deterministic verdicts",
      "CCTP-first canonical settlement path",
      "The Graph as the discovery and indexing layer",
      "Circle wallet / authority integration",
      "Privy sign-in and transaction UX",
    ],
  },
  {
    stage: "Intent Market",
    status: "PLANNED",
    capability: "Permissionless SolverVaults competing for the first valid fill.",
    items: [
      "Permissionless SolverVault factory and registry",
      "Open-source reference solver",
      "Global first-valid-fill execution",
      "Deterministic utilisation pricing",
    ],
  },
  {
    stage: "Pricing Evolution",
    status: "PLANNED",
    capability: "More than one audited way to price risk and allocate capital.",
    items: ["Multiple audited fee curves", "Richer risk premiums", "Capital allocation strategies"],
  },
  {
    stage: "Trust Minimisation",
    status: "PLANNED",
    capability: "Fewer privileged roles and a settlement path anyone can complete.",
    items: [
      "Permissionless settlement completion",
      "Hardened CCTP-to-intent correlation",
      "Reduced privileged roles",
      "Formalised solver and vault interfaces",
    ],
  },
  {
    stage: "V2 — Uniswap Integration",
    status: "PLANNED",
    capability: "Token-to-token intents with execution routed through Uniswap on the destination chain.",
    items: [
      "Token-to-token intents",
      "Uniswap routing on destination execution",
      "Quote context for non-USDC legs",
      "Slippage and execution guarantees at fill time",
    ],
  },
  {
    stage: "V3 — Hedera Expansion",
    status: "PLANNED",
    capability: "Extending intents and settlement beyond EVM mainnets into Hedera.",
    items: [
      "Hedera network support",
      "Hedera-side settlement and liquidity",
      "Cross-ecosystem intent routing",
    ],
  },
  {
    stage: "Network Expansion",
    status: "PLANNED",
    capability: "More supported EVM chains and deeper crosschain routing.",
    items: ["Additional supported EVM chains", "Deeper crosschain liquidity routing"],
  },
  {
    stage: "Agent Economy",
    status: "PLANNED",
    capability: "Paid, agent-facing market intelligence.",
    items: ["x402-gated market intelligence", "Agent-to-agent paid services"],
  },
  {
    stage: "Security",
    status: "PLANNED",
    capability: "Independent review plus staged exposure limits.",
    items: ["Independent audit", "Invariant and fuzz testing", "Monitoring and alerting", "Staged caps"],
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
