/**
 * The canonical cross-chain metadata Arcaidia attaches to a CCTP V2 burn
 * (DECISIONS.md D8). Carried verbatim in `BurnMessageV2.hookData`, so covered
 * by Circle's attestation. Must round-trip byte-identically with
 * `contracts/src/libraries/IntentHookLib.sol`.
 */

import { decodeAbiParameters, encodeAbiParameters } from 'viem';
import type { Address, Bytes32, Hex } from './types/primitives.js';

export const HOOK_VERSION = 1 as const;

/** `abi.encode(uint8, bytes32, address)` — three 32-byte words. */
export const HOOK_LENGTH_BYTES = 96;

const HOOK_ABI = [
  { name: 'version', type: 'uint8' },
  { name: 'intentId', type: 'bytes32' },
  { name: 'recipient', type: 'address' },
] as const;

export interface IntentHook {
  readonly intentId: Bytes32;
  readonly recipient: Address;
}

export class MalformedIntentHookError extends Error {}

export function encodeIntentHook(hook: IntentHook): Hex {
  return encodeAbiParameters(HOOK_ABI, [HOOK_VERSION, hook.intentId, hook.recipient]);
}

export function decodeIntentHook(hookData: Hex): IntentHook {
  const byteLength = (hookData.length - 2) / 2;
  if (byteLength !== HOOK_LENGTH_BYTES) {
    throw new MalformedIntentHookError(`Intent hook must be ${HOOK_LENGTH_BYTES} bytes, got ${byteLength}.`);
  }
  const [version, intentId, recipient] = decodeAbiParameters(HOOK_ABI, hookData);
  if (version !== HOOK_VERSION) {
    throw new MalformedIntentHookError(`Unsupported intent hook version ${version}.`);
  }
  return { intentId, recipient };
}
