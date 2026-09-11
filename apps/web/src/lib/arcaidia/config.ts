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
 *   VITE_SOLVER_QUOTE_URL                (POST /quote — WP-14 live estimate endpoint)
 *   VITE_MARKET_INTELLIGENCE_URL         (x402 market intelligence base URL)
 *   VITE_PRIVY_APP_ID                    (human owner login)
 */
import { CHAINS as DOMAIN_CHAINS, DEPLOYMENTS, type ChainKey } from "@arcaidia/domain";
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

/**
 * Arcaidia's own shared, unlimited indexer (WP-22) — SQL-over-HTTP, not
 * GraphQL (see `./nest.ts`). Committed defaults, mirroring the identical
 * pair in `packages/domain/src/config/chains.ts` exactly: same URLs, same
 * override-with-fallback shape via `VITE_SUBGRAPH_URL_{PREFIX}` (WP-23).
 * `str(...)` returning `null` (var unset) is what falls through to these —
 * an operator overrides only to point the browser build at their own
 * subgraph or indexer instead.
 */
const NEST_URL_ETHEREUM_SEPOLIA = "https://hackathon.89.167.109.4.sslip.io/arcaidia-sepolia";
const NEST_URL_ARC_TESTNET = "https://hackathon.89.167.109.4.sslip.io/arcaidia-arc";

/**
 * WP-30: env vars still win (an operator pointing the browser at their own deployment), but
 * the committed deployment record in `@arcaidia/domain` is the fallback — so the coordinated
 * redeploy (WP-31) configures this app by committing `deployments.ts`, with no env edits.
 */
const DOMAIN_KEY: Record<number, ChainKey> = {
  [ETHEREUM_SEPOLIA]: "ethereum-sepolia",
  [ARC_TESTNET]: "arc-testnet",
};
function committed(chainId: number) {
  const key = DOMAIN_KEY[chainId]!;
  return { contracts: DEPLOYMENTS[key], usdc: DOMAIN_CHAINS[key].settlementAsset.address as Address };
}

export const CHAIN_CONFIG: Record<number, ChainConfig> = {
  [ETHEREUM_SEPOLIA]: {
    chainId: ETHEREUM_SEPOLIA,
    rpcUrl: str("VITE_RPC_URL_ETHEREUM_SEPOLIA"),
    usdc: address("VITE_USDC_ETHEREUM_SEPOLIA") ?? committed(ETHEREUM_SEPOLIA).usdc,
    intentRouter:
      address("VITE_INTENT_ROUTER_ETHEREUM_SEPOLIA") ?? committed(ETHEREUM_SEPOLIA).contracts.intentRouter ?? null,
    houseVault:
      address("VITE_HOUSE_VAULT_ETHEREUM_SEPOLIA") ?? committed(ETHEREUM_SEPOLIA).contracts.liquidityVault ?? null,
    vaultFactory:
      address("VITE_VAULT_FACTORY_ETHEREUM_SEPOLIA") ?? committed(ETHEREUM_SEPOLIA).contracts.vaultFactory ?? null,
    subgraphUrl: str("VITE_SUBGRAPH_URL_ETHEREUM_SEPOLIA") ?? NEST_URL_ETHEREUM_SEPOLIA,
  },
  [ARC_TESTNET]: {
    chainId: ARC_TESTNET,
    rpcUrl: str("VITE_RPC_URL_ARC_TESTNET"),
    usdc: address("VITE_USDC_ARC_TESTNET") ?? committed(ARC_TESTNET).usdc,
    intentRouter: address("VITE_INTENT_ROUTER_ARC_TESTNET") ?? committed(ARC_TESTNET).contracts.intentRouter ?? null,
    houseVault: address("VITE_HOUSE_VAULT_ARC_TESTNET") ?? committed(ARC_TESTNET).contracts.liquidityVault ?? null,
    vaultFactory: address("VITE_VAULT_FACTORY_ARC_TESTNET") ?? committed(ARC_TESTNET).contracts.vaultFactory ?? null,
    subgraphUrl: str("VITE_SUBGRAPH_URL_ARC_TESTNET") ?? NEST_URL_ARC_TESTNET,
  },
};

/**
 * Trade intents (schema v1.1 `tokenOut`/`targetMinOut`) in the Transfer UI. Off until the Line 1
 * (Uniswap) markets are committed to `@arcaidia/domain`'s `SWAP_INFRASTRUCTURE` (WP-34); the
 * protocol already accepts them on chain, and canonical settlement delivers USDC if no solver
 * can satisfy the swap.
 */
export const TRADE_INTENTS_ENABLED = str("VITE_TRADE_INTENTS_ENABLED") === "true";

export const SUPPORTED_CHAIN_IDS = [ETHEREUM_SEPOLIA, ARC_TESTNET] as const;

export function chainConfig(chainId: number): ChainConfig | null {
  return CHAIN_CONFIG[chainId] ?? null;
}

export const SERVICES = {
  privyAppId: str("VITE_PRIVY_APP_ID"),
  solverTelemetryUrl: str("VITE_SOLVER_TELEMETRY_URL"),
  /** POST /quote (WP-14) — one solver process, one endpoint, not per-chain: sourceChainId/destinationChainId are request fields. */
  solverQuoteUrl: str("VITE_SOLVER_QUOTE_URL"),
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
