/**
 * Canonical settlement types.
 *
 * Deliberately free of any Circle-specific response shape. The risk engine and
 * the settlement agent consume these types; a `CircleCCTPAdapter` (WP-10) maps
 * Iris responses onto them, and a `MockSettlementAdapter` (WP-06) produces them
 * directly. Nothing above the adapter boundary knows Circle exists.
 */

import type { Address, Bytes32, TxHash, UnixSeconds } from './primitives.js';

/**
 * The lifecycle of one canonical settlement message.
 *
 * Distinct from `CanonicalStatus` in `status.ts`: that is the intent-level fact
 * (PENDING or SETTLED) derived from this finer-grained transport lifecycle.
 */
export const SettlementStatus = {
  /** Burn/commitment observed on the source chain. */
  INITIATED: 'INITIATED',
  /** Waiting for the attestation service to reach its finality threshold. */
  PENDING_ATTESTATION: 'PENDING_ATTESTATION',
  /** Attestation available; the destination transaction can now be submitted. */
  ATTESTED: 'ATTESTED',
  /** Destination receive transaction confirmed. */
  RECEIVED: 'RECEIVED',
  /** Funds correlated to the intent and routed to LP or recipient. */
  RECONCILED: 'RECONCILED',
  /** Terminal failure; requires operator attention. Never silently retried away. */
  FAILED: 'FAILED',
} as const;
export type SettlementStatus = (typeof SettlementStatus)[keyof typeof SettlementStatus];

/** Statuses from which the settlement agent must keep working. */
export const ACTIVE_SETTLEMENT_STATUSES: readonly SettlementStatus[] = [
  SettlementStatus.INITIATED,
  SettlementStatus.PENDING_ATTESTATION,
  SettlementStatus.ATTESTED,
  SettlementStatus.RECEIVED,
];

/**
 * Everything needed to correlate a canonical transfer back to its intent,
 * expressed in protocol-neutral terms.
 */
export interface SettlementReference {
  readonly intentId: Bytes32;
  readonly sourceChainId: number;
  readonly destinationChainId: number;
  /** Transport-level domain identifiers, resolved from chain config. */
  readonly sourceDomain: number;
  readonly destinationDomain: number;
  /** The source transaction carrying the commitment. */
  readonly sourceTxHash: TxHash;
  /**
   * Opaque message identifier from the settlement transport. For CCTP this is
   * the message hash; for the mock adapter it is a synthetic handle. Consumers
   * treat it as opaque.
   */
  readonly messageRef: Bytes32;
  /** Transport nonce, when the transport exposes one. */
  readonly messageNonce?: bigint;
  readonly initiatedAt: UnixSeconds;
}

/** Live state of one settlement, as reported by a `SettlementAdapter`. */
export interface SettlementState {
  readonly reference: SettlementReference;
  readonly status: SettlementStatus;
  /** Principal in flight, in the settlement asset's smallest unit. */
  readonly amount: bigint;
  /** Destination transaction that completed the receive, once submitted. */
  readonly destinationTxHash?: TxHash;
  /** Set when status is FAILED. */
  readonly failureReason?: string;
  readonly updatedAt: UnixSeconds;
}

/**
 * Aggregate settlement health — the risk engine's view of the canonical leg
 * (specification §18). Every field is derivable from `SettlementState` records
 * plus adapter reachability, so no Circle-specific surface is required here.
 */
export interface SettlementHealth {
  /**
   * Transport reachability and progress.
   *  - HEALTHY:     attesting and progressing normally
   *  - DEGRADED:    reachable but slowing, or backlog building
   *  - UNAVAILABLE: transport unreachable or not progressing at all
   */
  readonly transport: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE';
  /** Age of the oldest fast-filled but canonically unsettled intent. */
  readonly oldestUnsettledAgeSeconds: number | null;
  /** Aggregate principal advanced by LPs and awaiting reimbursement. */
  readonly pendingValue: bigint;
  /** Rolling-window mean canonical settlement time. */
  readonly averageSettlementLatencySeconds: number | null;
  /** Number of observations behind the rolling average. */
  readonly latencySampleSize: number;
  readonly observedAt: UnixSeconds;
}

/** Live state of one destination LiquidityVault, as observed. */
export interface VaultState {
  readonly chainId: number;
  readonly vault: Address;
  readonly asset: Address;
  /**
   * Liquid settlement asset actually held by the vault. This is what can be
   * advanced; it excludes principal already out on loan to recipients.
   */
  readonly totalBalance: bigint;
  /** ERC-4626 share supply. Zero before the first deposit. */
  readonly totalShares: bigint;
  /** Capital that must remain; not deployable for fills. */
  readonly reserveFloor: bigint;
  /** Principal advanced and awaiting canonical reimbursement. */
  readonly outstandingExposure: bigint;
  readonly paused: boolean;
  /** Block the observation was taken at, for staleness checks. */
  readonly blockNumber: bigint;
  readonly observedAt: UnixSeconds;
}

/**
 * ERC-4626 `totalAssets`: liquid balance plus principal advanced and awaiting
 * canonical reimbursement.
 *
 * The receivable must be counted. Omitting it would let an LP redeem while a
 * fill is in flight and take an unfairly cheap exit, with the remaining LPs
 * absorbing the outstanding exposure.
 */
export function totalAssets(vault: VaultState): bigint {
  return vault.totalBalance + vault.outstandingExposure;
}

/** Capital deployable for a fast fill right now, never below the reserve floor. */
export function availableLiquidity(vault: VaultState): bigint {
  const deployable = vault.totalBalance - vault.reserveFloor;
  return deployable > 0n ? deployable : 0n;
}

/**
 * Vault utilisation in basis points: advanced principal as a share of total
 * capital. Drives the fee curve. A vault with no capital reads as fully utilised
 * so the risk engine prices it out rather than dividing by zero.
 */
export function utilisationBps(vault: VaultState): number {
  const capital = vault.totalBalance + vault.outstandingExposure;
  if (capital === 0n) return 10_000;
  return Number((vault.outstandingExposure * 10_000n) / capital);
}
