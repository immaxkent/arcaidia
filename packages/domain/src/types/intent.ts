/**
 * The canonical Intent (specification §6).
 *
 * Direction is data. An intent carries `sourceChainId` and `destinationChainId`
 * as ordinary fields; nothing in this type, or anywhere downstream of it, names
 * a specific pair of chains. Swapping the two fields is the entire difference
 * between the two directions Arcaidia supports.
 *
 * Economic fields are immutable after creation. They are the preimage of
 * `intentId` (see `intent-id.ts`), so altering any of them yields a different
 * intent rather than a mutated one.
 */

import type { Address, Bps, Bytes32, TxHash, UnixSeconds } from './primitives.js';

/** The user-authored, immutable economic terms of a transfer. */
export interface IntentParams {
  /** Source owner; the address whose USDC is pulled by the router. */
  readonly sender: Address;
  /** Destination beneficiary. May differ from `sender`. */
  readonly recipient: Address;
  /** Settlement asset on the source chain. V1 allowlists USDC only. */
  readonly inputToken: Address;
  /** Amount pulled on the source chain, in the asset's smallest unit. */
  readonly amount: bigint;
  /** Chain the funds leave from. */
  readonly sourceChainId: number;
  /** Chain the recipient is paid on. */
  readonly destinationChainId: number;
  /** Hard user ceiling on the solver's fee. A quote above this must be rejected. */
  readonly maxFeeBps: Bps;
  /** No new fast fill may be authorised after this time. */
  readonly deadline: UnixSeconds;
  /** Per-sender replay protection. */
  readonly nonce: bigint;
}

/**
 * An intent as it exists after `ArcaidiaIntentRouter.createIntent` has pulled the
 * funds, initiated CCTP and emitted `IntentCreated`.
 */
export interface Intent extends IntentParams {
  /** Deterministic identifier; the replay key across both chains. */
  readonly intentId: Bytes32;
  /** The source transaction that committed the funds. */
  readonly sourceTxHash: TxHash;
  /** Source block, for the confirmation-threshold check. */
  readonly sourceBlockNumber: bigint;
  /** When the source commitment was mined. */
  readonly createdAt: UnixSeconds;
  /**
   * Correlation handle for the canonical settlement leg. Chain-agnostic by
   * design — see `SettlementReference`; the router records whatever the
   * configured settlement initiator returns.
   */
  readonly settlementRef: Bytes32;
}
