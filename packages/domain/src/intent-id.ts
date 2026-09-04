/**
 * Deterministic intent identity.
 *
 * `intentId` is the replay key on both chains and the correlation key across the
 * indexer, the agent and the settlement worker. It must be computed identically
 * in TypeScript and in Solidity — WP-01 adds a differential test asserting that
 * `ArcaidiaIntentRouter` produces the same bytes for the same fields.
 *
 * The preimage is exactly the immutable economic terms of the intent. Change any
 * of them and you have a different intent, not a mutated one.
 *
 * Solidity equivalent:
 *
 *   keccak256(abi.encode(
 *     INTENT_TYPEHASH, sender, recipient, inputToken, amount,
 *     sourceChainId, destinationChainId, maxFeeBps, deadline, nonce
 *   ))
 */

import { encodeAbiParameters, keccak256, toHex } from 'viem';
import type { Bytes32 } from './types/primitives.js';
import type { IntentParams } from './types/intent.js';

/**
 * Domain-separating tag, mixed into the preimage so an `intentId` can never
 * collide with an unrelated `keccak256(abi.encode(...))` of the same shape.
 */
export const INTENT_TYPEHASH: Bytes32 = keccak256(
  toHex(
    'Intent(address sender,address recipient,address inputToken,uint256 amount,uint256 sourceChainId,uint256 destinationChainId,uint16 maxFeeBps,uint64 deadline,uint256 nonce)',
  ),
);

const INTENT_ABI_PARAMS = [
  { name: 'typehash', type: 'bytes32' },
  { name: 'sender', type: 'address' },
  { name: 'recipient', type: 'address' },
  { name: 'inputToken', type: 'address' },
  { name: 'amount', type: 'uint256' },
  { name: 'sourceChainId', type: 'uint256' },
  { name: 'destinationChainId', type: 'uint256' },
  { name: 'maxFeeBps', type: 'uint16' },
  { name: 'deadline', type: 'uint64' },
  { name: 'nonce', type: 'uint256' },
] as const;

/**
 * Compute the canonical intent id.
 *
 * Field order is fixed by `INTENT_ABI_PARAMS`, so the result depends only on the
 * values — passing the same intent with its object keys in a different order
 * yields the same id.
 */
export function computeIntentId(params: IntentParams): Bytes32 {
  return keccak256(
    encodeAbiParameters(INTENT_ABI_PARAMS, [
      INTENT_TYPEHASH,
      params.sender,
      params.recipient,
      params.inputToken,
      params.amount,
      BigInt(params.sourceChainId),
      BigInt(params.destinationChainId),
      params.maxFeeBps,
      BigInt(params.deadline),
      params.nonce,
    ]),
  );
}
