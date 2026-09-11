/**
 * The canonical Intent — schema v1.1 (DECISIONS.md D5).
 *
 * Direction is data. An intent carries `sourceChainId` and `destinationChainId`
 * as ordinary fields; nothing in this type, or anywhere downstream of it, names
 * a specific pair of chains. Swapping the two fields is the entire difference
 * between the two directions Arcaidia supports.
 *
 * Economic fields are immutable after creation. They are the preimage of
 * `intentId` (see `intent-id.ts`), so altering any of them yields a different
 * intent rather than a mutated one. Field order below is the preimage order
 * and matches `contracts/src/libraries/ArcaidiaTypes.sol` exactly.
 */

import type { Address, Bps, Bytes32, TxHash, UnixSeconds } from './primitives.js';

/** Schema version carried by every intent. Bump only with a new `INTENT_TYPEHASH`. */
export const INTENT_VERSION = 1 as const;

/**
 * Sentinel for `tokenOut`: "the destination chain's settlement asset" — USDC,
 * whatever its address is there. A sentinel rather than the literal USDC
 * address keeps the intent chain-agnostic, like every other field.
 */
export const USDC_TOKEN_OUT: Address = '0x0000000000000000000000000000000000000000';

/** The user-authored, immutable economic terms of a transfer. */
export interface IntentParams {
  /** Always `INTENT_VERSION` for intents this package understands. */
  readonly intentVersion: number;
  /** Source owner; the address whose USDC is pulled by the router. */
  readonly sender: Address;
  /** Destination beneficiary. May differ from `sender`. */
  readonly recipient: Address;
  /** Settlement asset on the source chain. USDC only. */
  readonly inputToken: Address;
  /** Amount pulled on the source chain, in the asset's smallest unit. */
  readonly amount: bigint;
  /** Chain the funds leave from. */
  readonly sourceChainId: number;
  /** Chain the recipient is paid on. */
  readonly destinationChainId: number;
  /**
   * Hard user ceiling on the fast-fill fee. Enforced on chain by the destination
   * vault, which recomputes `intentId` from these very fields (D6).
   */
  readonly maxFeeBps: Bps;
  /** No new fast fill may be authorised after this time. */
  readonly deadline: UnixSeconds;
  /** Per-sender replay protection. */
  readonly nonce: bigint;
  /**
   * What the recipient ultimately wants on the destination chain.
   * `USDC_TOKEN_OUT` for a plain transfer; anything else is a trade intent
   * (Uniswap workstream, D9) whose fast path may swap and whose fallback is USDC.
   */
  readonly tokenOut: Address;
  /**
   * Minimum acceptable `tokenOut` delivered. Must be `0n` when `tokenOut` is
   * the sentinel and non-zero otherwise — the router enforces both.
   */
  readonly targetMinOut: bigint;
}

/** True when the user wants something other than USDC on the destination. */
export function isTradeIntent(params: Pick<IntentParams, 'tokenOut'>): boolean {
  return params.tokenOut.toLowerCase() !== USDC_TOKEN_OUT;
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

/**
 * The trade fields of an intent observed from a **v1** `IntentCreated` event.
 *
 * The v1 router accepted USDC-only transfers and its event carries no
 * `intentVersion`/`tokenOut`/`targetMinOut`; these are the values that event
 * means by construction, not a guess. Exists so observation providers can
 * keep serving the live v1 deployment until the v2 router is live (WP-25/28),
 * at which point every use of this constant is deleted.
 */
export const LEGACY_V1_INTENT_FIELDS = {
  intentVersion: INTENT_VERSION,
  tokenOut: USDC_TOKEN_OUT,
  targetMinOut: 0n,
} as const;
