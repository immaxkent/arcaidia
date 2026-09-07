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
