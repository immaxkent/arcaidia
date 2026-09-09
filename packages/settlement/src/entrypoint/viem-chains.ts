/**
 * viem chain definitions for the two chains this worker settles on.
 *
 * Duplicated from @arcaidia/agent's identical file rather than imported —
 * see this package's index.ts and observation/graph-client.ts for why the
 * two packages stay independently swappable halves. The RPC URL used at
 * request time comes from `ChainEntrypointConfig.rpcUrl`, passed separately
 * to `http(...)` at client construction — these definitions only need to be
 * structurally correct (id, native currency, explorer).
 */

import { defineChain, type Chain } from 'viem';
import { sepolia } from 'viem/chains';

export const ethereumSepoliaChain: Chain = sepolia;

export const arcTestnetChain: Chain = defineChain({
  id: 5_042_002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.io'] } },
  blockExplorers: { default: { name: 'Arcscan', url: 'https://testnet.arcscan.app' } },
});
