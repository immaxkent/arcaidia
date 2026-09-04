/**
 * Evidence read from the source chain.
 *
 * The Graph is the discovery layer, but it is not an authorisation oracle: a
 * compromised or merely stale indexer must never be sufficient to move LP
 * capital. Before risking anything the agent re-reads the source transaction
 * from an RPC and checks it against the intent it is about to fill.
 *
 * This module holds the *shape* of that evidence and the port that produces it.
 * The checking itself is a pure function over this shape (`verify-source.ts`),
 * so every rejection branch is unit-testable without a chain.
 */

import type { Address, Bytes32, TxHash } from '@arcaidia/domain';

/** The `IntentCreated` event as decoded from the source receipt. */
export interface IntentCreatedEvidence {
  readonly intentId: Bytes32;
  readonly sender: Address;
  readonly recipient: Address;
  readonly inputToken: Address;
  readonly amount: bigint;
  readonly sourceChainId: number;
  readonly destinationChainId: number;
  readonly maxFeeBps: number;
  readonly deadline: number;
  readonly nonce: bigint;
  /**
   * The canonical settlement handle recorded by the router. Zero would mean the
   * router emitted an intent without committing the funds — which the contract
   * makes impossible, so seeing it here means we are not looking at our router.
   */
  readonly settlementRef: Bytes32;
  /** The contract that emitted the event. */
  readonly emitter: Address;
}

/** Everything the verifier needs about one source transaction. */
export interface SourceEvidence {
  readonly txHash: TxHash;
  /** `null` when the transaction cannot be found at all. */
  readonly status: 'success' | 'reverted' | null;
  /** The address the transaction called. */
  readonly to: Address | null;
  readonly blockNumber: bigint;
  /** Head of the chain at read time, for the confirmation count. */
  readonly currentBlockNumber: bigint;
  /** `null` when no `IntentCreated` was emitted. */
  readonly intentCreated: IntentCreatedEvidence | null;
}

/**
 * Reads source-chain evidence. Implemented over viem against an RPC.
 *
 * Deliberately narrow: the agent asks one question — what does the chain say
 * about this transaction — and nothing about the provider leaks past it.
 */
export interface SourceChainReader {
  readEvidence(chainId: number, txHash: TxHash): Promise<SourceEvidence>;
}
