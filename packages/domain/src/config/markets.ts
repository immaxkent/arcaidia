/**
 * Destination-token markets — the swap infrastructure the Line 1 (Uniswap)
 * workstream deploys. Shape reserved by WP-24; values committed by Line 1.
 * See `work-packages/LINE-1-UNISWAP-INTERFACE.md` §4.
 *
 * `null` means "no swap infrastructure on this chain yet": the frontend hides
 * trade-intent fields, the solver declines every trade intent
 * (`TRADE_NOT_SUPPORTED`), and the vault delivers USDC. Nothing fabricates a
 * market that doesn't exist.
 */

import type { Address } from '../types/primitives.js';
import type { ChainKey, TokenConfig } from './chains.js';

export interface DestinationMarket {
  readonly chainId: number;
  /** The asset a trade intent's `tokenOut` may name. */
  readonly tokenOut: TokenConfig;
  /** The USDC/`tokenOut` pair. */
  readonly pool: Address;
  readonly kind: 'uniswap-v2';
}

export interface SwapInfrastructure {
  readonly chainId: number;
  readonly factory: Address;
  readonly router: Address;
  /** The `ISwapAdapter` a vault owner sets via `setSwapAdapter` (WP-34). */
  readonly swapAdapter: Address;
  readonly markets: readonly DestinationMarket[];
}

export const SWAP_INFRASTRUCTURE: Readonly<Record<ChainKey, SwapInfrastructure | null>> = {
  'ethereum-sepolia': null,
  'arc-testnet': null,
} as const;

/** The markets available for `tokenOut` on a chain, or none. */
export function marketsFor(chain: ChainKey): readonly DestinationMarket[] {
  return SWAP_INFRASTRUCTURE[chain]?.markets ?? [];
}
