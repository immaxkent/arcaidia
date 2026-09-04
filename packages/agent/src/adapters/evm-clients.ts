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
  getBlockNumber(): Promise<bigint>;
}

export interface EvmWriteClient {
  writeContract(args: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  }): Promise<TxHash>;
}
