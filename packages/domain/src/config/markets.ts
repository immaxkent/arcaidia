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
  'ethereum-sepolia': {
    chainId: 11155111,
    factory: '0xEC91Ac2ae295f63Fde4B865c6607a9973703b2c2',
    router: '0xb78911b8438725B3B834e12Fe9D4e716c8D38c72',
    swapAdapter: '0xF8a854866226d2Df7e185f9f98a8C1C73422809F',
    markets: [
      {
        chainId: 11155111,
        tokenOut: {address: '0x7237Bdd03E3D260cCdE6394aC4De04665237Fb1a', symbol: 'mETH', decimals: 18},
        pool: '0x6f85365761696060A726F6f3fE9DBff47a4A1Ca5',
        kind: 'uniswap-v2',
      },
      {
        chainId: 11155111,
        tokenOut: {address: '0xA350b619485dcD7DcbA13a7f71B1e3e02Ca9A94A', symbol: 'mAAVE', decimals: 18},
        pool: '0xd7670Cf29103dab86C28706B653918b62C25D4F0',
        kind: 'uniswap-v2',
      },
      {
        chainId: 11155111,
        tokenOut: {address: '0x573AbBb63A6DF7014a19F96CC3B70E076DE2Cd8e', symbol: 'mGRT', decimals: 18},
        pool: '0x74170D3f7F7Dc919a48dfB099c5e79ceB7898380',
        kind: 'uniswap-v2',
      },
      {
        chainId: 11155111,
        tokenOut: {address: '0xc1C3c3194F5087A3061C647284BAb1d1B84ee361', symbol: 'mPEPE', decimals: 18},
        pool: '0x842e6cE58a60cdcE273897d8DffC46a0120B4067',
        kind: 'uniswap-v2',
      },
    ],
  },
  'arc-testnet': {
    chainId: 5042002,
    factory: '0xC9dDc8EDD66683BeF258b11E0d98Fe9af8228099',
    router: '0x000b77298C9AB86eaB86801Fd0caA29a38709D1b',
    swapAdapter: '0xFD3a3fC4B370C8782D1B7F4FD254492E8d32B779',
    markets: [
      {
        chainId: 5042002,
        tokenOut: {address: '0x69F7A2E446E4C884DaA8BEb182672fD806ac657e', symbol: 'mETH', decimals: 18},
        pool: '0x751DdF801D77c0C27bcCDe71664b1a1F72DC1CD9',
        kind: 'uniswap-v2',
      },
      {
        chainId: 5042002,
        tokenOut: {address: '0x568C5574F80cb256A4b878FB4156c78386963723', symbol: 'mAAVE', decimals: 18},
        pool: '0xF3C05B264654DdDBF60970657a0a0FB13Be53570',
        kind: 'uniswap-v2',
      },
      {
        chainId: 5042002,
        tokenOut: {address: '0xEfF4e1299d1dD29C183Adc5eE448Cc3F9e11c071', symbol: 'mGRT', decimals: 18},
        pool: '0xEFBB668c27bbD1a960A13BcCE601bA95a3e8Eb98',
        kind: 'uniswap-v2',
      },
      {
        chainId: 5042002,
        tokenOut: {address: '0x6A917828B299f9500833dCC6CD1EBD8094DDCd63', symbol: 'mPEPE', decimals: 18},
        pool: '0x844429A5cA004895b38E227f2354A8811f3A2746',
        kind: 'uniswap-v2',
      },
    ],
  },
} as const;

/** The markets available for `tokenOut` on a chain, or none. */
export function marketsFor(chain: ChainKey): readonly DestinationMarket[] {
  return SWAP_INFRASTRUCTURE[chain]?.markets ?? [];
}
