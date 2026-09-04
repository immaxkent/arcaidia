/**
 * Primitive aliases shared across the protocol.
 *
 * These exist so downstream packages never reach for `string` where an address
 * or a hash is meant. viem's branded hex types give us compile-time safety at
 * zero runtime cost.
 */

export type { Address, Hex } from 'viem';
import type { Hex } from 'viem';

/** A 32-byte transaction hash. */
export type TxHash = Hex;

/** A 32-byte identifier (intent ids, CCTP message hashes). */
export type Bytes32 = Hex;

/** Unix seconds. Always seconds — never milliseconds — at protocol boundaries. */
export type UnixSeconds = number;

/** Basis points. 10_000 bps = 100%. */
export type Bps = number;

export const BPS_DENOMINATOR = 10_000 as const;
