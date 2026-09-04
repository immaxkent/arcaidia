/**
 * FillAuthorization — the narrow, short-lived permission that lets the
 * destination LiquidityVault pay a recipient from LP inventory
 * (specification §8).
 *
 * The agent has no "send vault money" method. It has this: a signed statement
 * about one specific intent, bound to one specific source transaction, valid for
 * tens of seconds. Everything the vault needs to reject a bad fill is inside it.
 */

import type { Address, Bytes32, TxHash, UnixSeconds } from './primitives.js';

export interface FillAuthorization {
  /** Must be unused on the destination vault. */
  readonly intentId: Bytes32;
  /** Binds the authorization to the chain the commitment was made on. */
  readonly sourceChainId: number;
  /** Binds it to the exact verified source commitment. */
  readonly sourceTxHash: TxHash;
  /** The submitter cannot change who gets paid. */
  readonly recipient: Address;
  /** Principal committed on the source chain. */
  readonly inputAmount: bigint;
  /** What the recipient receives: `inputAmount - feeAmount`. */
  readonly outputAmount: bigint;
  /** Must satisfy both the protocol maximum and the user's `maxFeeBps`. */
  readonly feeAmount: bigint;
  /** Short-lived — 30 to 60 seconds. Expired authorizations are unusable. */
  readonly expiry: UnixSeconds;
  /** Agent-side replay protection, independent of `intentId`. */
  readonly nonce: bigint;
}

/** A `FillAuthorization` together with the signature that authorises it. */
export interface SignedFillAuthorization {
  readonly authorization: FillAuthorization;
  /** EIP-712 signature over the typed data. */
  readonly signature: `0x${string}`;
  /** The authority that produced it; must be allowlisted by the vault. */
  readonly signer: Address;
}
