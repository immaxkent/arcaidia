/**
 * The narrow slices of an EVM client the adapters actually need.
 *
 * viem's `PublicClient` and `WalletClient` satisfy these structurally, so the
 * adapters take real clients in production while tests can supply a stub
 * without constructing a transport. Depending on the whole client would make
 * these adapters untestable without a network, and an adapter that can only be
 * tested against a live chain is one that does not get tested.
 */

import type { Address, Hex, TxHash } from '@arcaidia/domain';

export interface EvmLog {
  readonly address: Address;
  readonly topics: readonly Hex[];
  readonly data: Hex;
}

export interface EvmReceipt {
  readonly status: 'success' | 'reverted';
  readonly to: Address | null;
  readonly blockNumber: bigint;
  readonly logs: readonly EvmLog[];
}

export interface EvmReadClient {
  getTransactionReceipt(args: { hash: TxHash }): Promise<EvmReceipt>;
  /**
   * @param args viem caches the head by default. Confirmation counting passes
   *   `cacheTime: 0`, because a stale head reads as *fewer* confirmations than
   *   the chain actually has, which silently rejects intents that are perfectly
   *   valid.
   */
  getBlockNumber(args?: { cacheTime?: number }): Promise<bigint>;
}

export interface EvmWriteClient {
  writeContract(args: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  }): Promise<TxHash>;
}

/**
 * Read-only contract calls — separate from `EvmReadClient` above, which is
 * scoped to source-transaction verification specifically. Vault *config*
 * (reserveFloor, maxFillAmount, maxOutstandingExposure) is a different
 * concern: it must come from the chain directly, never a subgraph, because
 * nothing indexes it — see GraphObservationProvider's own docs for why.
 */
export interface EvmContractReadClient {
  readContract(args: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
}

/** Waits for a submitted transaction to be mined — viem's PublicClient, structurally. */
export interface EvmReceiptWaiter {
  waitForTransactionReceipt(args: { hash: TxHash }): Promise<{ status: 'success' | 'reverted' }>;
}

/** A per-chain receipt waiter, the same viem `createPublicClient` narrowed to one method. */
export function buildReceiptWaiters(
  chains: readonly { chainId: number; rpcUrl: string }[],
  make: (chainId: number, rpcUrl: string) => EvmReceiptWaiter,
): ReadonlyMap<number, EvmReceiptWaiter> {
  const clients = new Map<number, EvmReceiptWaiter>();
  for (const chain of chains) clients.set(chain.chainId, make(chain.chainId, chain.rpcUrl));
  return clients;
}
