/**
 * viem chain definitions for the two chains this solver watches.
 *
 * The RPC URL used at request time comes from `ChainEntrypointConfig.rpcUrl`,
 * passed separately to `http(...)` at client construction — these definitions
 * only need to be structurally correct (id, native currency, explorer), not
 * carry the "real" endpoint themselves.
 *
 * Arc is not in `viem/chains`, so it is defined here per the backend's own
 * verified parameters (work-packages/OPEN-QUESTIONS.md, Q8): EVM-compatible,
 * USDC as the native gas token at 18 decimals for gas accounting.
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
