/**
 * Central configuration for chain-dependent, contract-dependent and
 * environment-dependent values.
 *
 * INTEGRATION NOTE
 * ----------------
 * Presentation components must never hardcode an address, RPC URL or endpoint.
 * They read from here. Everything is `null` until the corresponding env var is
 * supplied, and every consumer renders an honest unavailable state instead of a
 * placeholder value.
 *
 * Env vars (Vite, browser-exposed — publishable values only):
 *   VITE_RPC_URL_ETHEREUM_SEPOLIA
 *   VITE_RPC_URL_ARC_TESTNET
 *   VITE_USDC_ETHEREUM_SEPOLIA
 *   VITE_USDC_ARC_TESTNET
 *   VITE_INTENT_ROUTER_ETHEREUM_SEPOLIA
 *   VITE_INTENT_ROUTER_ARC_TESTNET
 *   VITE_HOUSE_VAULT_ETHEREUM_SEPOLIA
 *   VITE_HOUSE_VAULT_ARC_TESTNET
 *   VITE_VAULT_FACTORY_ETHEREUM_SEPOLIA
 *   VITE_VAULT_FACTORY_ARC_TESTNET
 *   VITE_SUBGRAPH_URL_ETHEREUM_SEPOLIA   (The Graph — fills / intent history)
 *   VITE_SUBGRAPH_URL_ARC_TESTNET
 *   VITE_SOLVER_TELEMETRY_URL            (optional solver telemetry WS/SSE)
 *   VITE_MARKET_INTELLIGENCE_URL         (x402 market intelligence base URL)
 *   VITE_PRIVY_APP_ID                    (human owner login)
 */
import { ARC_TESTNET, ETHEREUM_SEPOLIA, type Address } from "./types";

type Env = Record<string, string | undefined>;
const env: Env = (import.meta as unknown as { env?: Env }).env ?? {};

function str(key: string): string | null {
  const value = env[key];
  return value && value.trim().length > 0 ? value.trim() : null;
}

function address(key: string): Address | null {
  const value = str(key);
  return value && /^0x[a-fA-F0-9]{40}$/.test(value) ? (value as Address) : null;
}

export interface ChainConfig {
  chainId: number;
  rpcUrl: string | null;
  usdc: Address | null;
  intentRouter: Address | null;
  /** V1 ships one Arcaidia House Vault per supported chain. */
  houseVault: Address | null;
  /** Intent Market (later): factory/registry emitting SolverVault creation events. */
  vaultFactory: Address | null;
  /** The Graph endpoint for indexed fills / intent history. */
  subgraphUrl: string | null;
}

export const CHAIN_CONFIG: Record<number, ChainConfig> = {
  [ETHEREUM_SEPOLIA]: {
    chainId: ETHEREUM_SEPOLIA,
    rpcUrl: str("VITE_RPC_URL_ETHEREUM_SEPOLIA"),
    usdc: address("VITE_USDC_ETHEREUM_SEPOLIA"),
    intentRouter: address("VITE_INTENT_ROUTER_ETHEREUM_SEPOLIA"),
    houseVault: address("VITE_HOUSE_VAULT_ETHEREUM_SEPOLIA"),
    vaultFactory: address("VITE_VAULT_FACTORY_ETHEREUM_SEPOLIA"),
    subgraphUrl: str("VITE_SUBGRAPH_URL_ETHEREUM_SEPOLIA"),
  },
  [ARC_TESTNET]: {
    chainId: ARC_TESTNET,
    rpcUrl: str("VITE_RPC_URL_ARC_TESTNET"),
    usdc: address("VITE_USDC_ARC_TESTNET"),
    intentRouter: address("VITE_INTENT_ROUTER_ARC_TESTNET"),
    houseVault: address("VITE_HOUSE_VAULT_ARC_TESTNET"),
    vaultFactory: address("VITE_VAULT_FACTORY_ARC_TESTNET"),
    subgraphUrl: str("VITE_SUBGRAPH_URL_ARC_TESTNET"),
  },
};

export const SUPPORTED_CHAIN_IDS = [ETHEREUM_SEPOLIA, ARC_TESTNET] as const;

export function chainConfig(chainId: number): ChainConfig | null {
  return CHAIN_CONFIG[chainId] ?? null;
}

export const SERVICES = {
  privyAppId: str("VITE_PRIVY_APP_ID"),
  solverTelemetryUrl: str("VITE_SOLVER_TELEMETRY_URL"),
  marketIntelligenceUrl: str("VITE_MARKET_INTELLIGENCE_URL"),
};

/**
 * Demo mode is opt-in and OFF by default. There are currently no fixtures in the
 * repository, so enabling it changes nothing except showing the DEMO DATA badge.
 * Any future fixtures must live in src/demo/ and only be read behind this flag.
 */
export const DEMO_MODE = str("VITE_DEMO_MODE") === "true";

/** Protocol-configured transfer limits, when the deployment publishes them. */
export const PROTOCOL_LIMITS = {
  /** Max single intent size, in 6-decimal USDC. */
  maxIntentAmount: null as bigint | null,
  /** Default user fee ceiling in bps, if the deployment configures one. */
  defaultMaxFeeBps: null as number | null,
};

export function explorerTxUrl(chainId: number, txHash: string): string | null {
  const base = CHAIN_EXPLORERS[chainId];
  return base ? `${base}/tx/${txHash}` : null;
}

export function explorerAddressUrl(chainId: number, addr: string): string | null {
  const base = CHAIN_EXPLORERS[chainId];
  return base ? `${base}/address/${addr}` : null;
}

const CHAIN_EXPLORERS: Record<number, string> = {
  [ETHEREUM_SEPOLIA]: "https://sepolia.etherscan.io",
  [ARC_TESTNET]: "https://testnet.arcscan.app",
};
