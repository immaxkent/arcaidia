/**
 * Chain configuration — the single place where a chain-specific value may live.
 *
 * Direction resolution is a lookup in this table, never a branch in code. There
 * is no constant, type or function anywhere in Arcaidia naming a specific
 * direction; `resolveRoute(sourceChainId, destinationChainId)` returns the two
 * endpoints and everything downstream reads them as `source` and `destination`.
 *
 * Every address below was verified against official documentation and, where
 * noted, against a live RPC call on 2026-09-04. See work-packages/OPEN-QUESTIONS.md.
 */

import type { Address } from '../types/primitives.js';
import { DEPLOYMENTS } from './deployments.js';

/** Stable key for a configured chain. Used in logs, config files and CLI flags. */
export type ChainKey = 'ethereum-sepolia' | 'arc-testnet';

export interface TokenConfig {
  readonly address: Address;
  readonly symbol: string;
  readonly decimals: number;
}

/**
 * Canonical settlement transport parameters. Named generically: the domain model
 * does not depend on Circle, and a different transport would populate the same
 * shape.
 */
export interface SettlementTransportConfig {
  /** Transport-issued domain identifier. Unrelated to EVM chain IDs. */
  readonly domain: number;
  readonly tokenMessenger: Address;
  readonly messageTransmitter: Address;
  readonly tokenMinter: Address;
}

/**
 * Addresses of Arcaidia's own contracts. Populated by the CREATE2 deployment in
 * WP-01 — which is expected to produce the *same* addresses on every chain.
 */
export interface ProtocolContracts {
  readonly intentRouter?: Address;
  readonly liquidityVault?: Address;
  readonly settlementReceiver?: Address;
}

export interface ChainConfig {
  readonly key: ChainKey;
  readonly chainId: number;
  readonly name: string;
  readonly rpcUrl: string;
  readonly explorerUrl: string;
  /**
   * Network identifier used in `subgraph.yaml` for this chain (WP-08).
   */
  readonly graphNetwork: string;
  /**
   * The settlement asset. Selecting MockUSDC or real USDC is a change to this
   * field and nothing else — there is no runtime mock/real switch anywhere in
   * the protocol, which sees only a configured IERC20.
   */
  readonly settlementAsset: TokenConfig;
  readonly settlementTransport: SettlementTransportConfig;
  readonly contracts: ProtocolContracts;
  /**
   * Deterministic deployment factory (Arachnid's CREATE2 proxy). Verified
   * present at this address on both chains via `eth_getCode`, which is what
   * makes identical protocol addresses achievable.
   */
  readonly create2Factory: Address;
  /**
   * Whether the native gas token is the settlement asset itself. True on Arc,
   * where USDC is the gas token; the vault must therefore never assume gas and
   * inventory are separate balances.
   */
  readonly gasTokenIsSettlementAsset: boolean;
}

/** Arachnid's deterministic deployment proxy — same address on both chains. */
export const CREATE2_FACTORY: Address = '0x4e59b44847b379578588920cA78FbF26c0B4956C';

/**
 * CCTP V2 contracts are deployed at identical addresses on Ethereum Sepolia and
 * Arc testnet. Verified live via `eth_getCode` on both chains, 2026-09-04.
 */
const CCTP_V2_TESTNET = {
  tokenMessenger: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
  messageTransmitter: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',
  tokenMinter: '0xb43db544E2c27092c107639Ad201b3dEfAbcF192',
} as const satisfies Omit<SettlementTransportConfig, 'domain'>;

export const CHAINS: Readonly<Record<ChainKey, ChainConfig>> = {
  'ethereum-sepolia': {
    key: 'ethereum-sepolia',
    chainId: 11155111,
    name: 'Ethereum Sepolia',
    rpcUrl: process.env['ETHEREUM_SEPOLIA_RPC_URL'] ?? 'https://ethereum-sepolia-rpc.publicnode.com',
    explorerUrl: 'https://sepolia.etherscan.io',
    graphNetwork: 'sepolia',
    settlementAsset: {
      address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      symbol: 'USDC',
      decimals: 6,
    },
    settlementTransport: { domain: 0, ...CCTP_V2_TESTNET },
    contracts: DEPLOYMENTS['ethereum-sepolia'],
    create2Factory: CREATE2_FACTORY,
    gasTokenIsSettlementAsset: false,
  },
  'arc-testnet': {
    key: 'arc-testnet',
    chainId: 5042002,
    name: 'Arc Testnet',
    rpcUrl: process.env['ARC_TESTNET_RPC_URL'] ?? 'https://rpc.testnet.arc.io',
    explorerUrl: 'https://testnet.arcscan.app',
    graphNetwork: 'arc-testnet',
    settlementAsset: {
      // ERC-20 facade over Arc's native USDC gas token. `decimals()` returns 6
      // and `symbol()` returns "USDC"; both confirmed by live eth_call.
      address: '0x3600000000000000000000000000000000000000',
      symbol: 'USDC',
      decimals: 6,
    },
    settlementTransport: { domain: 26, ...CCTP_V2_TESTNET },
    contracts: DEPLOYMENTS['arc-testnet'],
    create2Factory: CREATE2_FACTORY,
    gasTokenIsSettlementAsset: true,
  },
} as const;

export const CHAIN_KEYS = Object.keys(CHAINS) as readonly ChainKey[];

const BY_CHAIN_ID = new Map<number, ChainConfig>(
  Object.values(CHAINS).map((chain) => [chain.chainId, chain]),
);

/** Look up a configured chain, or `undefined` if it is not configured. */
export function findChain(chainId: number): ChainConfig | undefined {
  return BY_CHAIN_ID.get(chainId);
}

/**
 * A resolved transfer route: which chain is acting as source and which as
 * destination for one particular intent. Both roles are filled by the same
 * `ChainConfig` shape, because both chains run the same contracts.
 */
export interface Route {
  readonly source: ChainConfig;
  readonly destination: ChainConfig;
}

/** True when both chains are configured and distinct. */
export function isSupportedRoute(sourceChainId: number, destinationChainId: number): boolean {
  return (
    sourceChainId !== destinationChainId &&
    BY_CHAIN_ID.has(sourceChainId) &&
    BY_CHAIN_ID.has(destinationChainId)
  );
}

/** Every route the current configuration supports, in both directions. */
export function supportedRoutes(): readonly Route[] {
  const chains = Object.values(CHAINS);
  const routes: Route[] = [];
  for (const source of chains) {
    for (const destination of chains) {
      if (source.chainId !== destination.chainId) routes.push({ source, destination });
    }
  }
  return routes;
}
