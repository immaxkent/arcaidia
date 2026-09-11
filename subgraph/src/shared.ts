import { BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts';
import { FeeSnapshot, ProtocolState, Vault } from '../generated/schema';
import { feeBpsAt, utilisationOf } from './fee-policy';

/**
 * Aggregates maintained incrementally.
 *
 * The solver reads these on every decision, so they cannot be a query-time sum
 * over the whole history: that cost grows with volume and would quietly slow
 * the agent down exactly as the protocol became busy.
 */

export const PROTOCOL_ID = 'arcaidia';

export function protocolState(event: ethereum.Event): ProtocolState {
  let state = ProtocolState.load(PROTOCOL_ID);

  if (state == null) {
    state = new ProtocolState(PROTOCOL_ID);
    state.chainId = BigInt.fromI32(0);
    state.vaultCount = BigInt.zero();
    state.intentsCreated = BigInt.zero();
    state.tradeIntentsCreated = BigInt.zero();
    state.intentsFilled = BigInt.zero();
    state.intentsSettled = BigInt.zero();
    state.intentsFallenBack = BigInt.zero();
    state.pendingSettlementValue = BigInt.zero();
    state.oldestUnsettledTimestamp = BigInt.zero();
    state.totalFeesEarned = BigInt.zero();
  }

  state.updatedAtBlock = event.block.number;
  state.updatedAtTimestamp = event.block.timestamp;
  return state as ProtocolState;
}

/**
 * The vault an event was emitted by. Every vault this subgraph knows about was
 * created through the factory (`handleVaultCreated` instantiates the template),
 * so a missing entity here means the template fired before the factory handler
 * — which cannot happen — and is treated as a hard error rather than fabricated.
 */
export function vaultState(event: ethereum.Event): Vault {
  const vault = Vault.load(event.address);
  if (vault == null) {
    throw new Error('Vault event from an address the factory never created: ' + event.address.toHexString());
  }
  vault.updatedAtBlock = event.block.number;
  vault.updatedAtTimestamp = event.block.timestamp;
  return vault as Vault;
}

/**
 * Recompute the live tier and record a snapshot. Called after every state
 * change that moves balance or exposure, so the fee series is complete without
 * any query-time reconstruction.
 */
export function refreshFeeTier(vault: Vault, event: ethereum.Event): void {
  const utilisation = utilisationOf(vault);
  vault.utilisationBps = utilisation;
  vault.currentFeeBps = feeBpsAt(vault, utilisation);

  const snapshot = new FeeSnapshot(eventId(event));
  snapshot.vault = vault.id;
  snapshot.utilisationBps = utilisation;
  snapshot.feeBps = vault.currentFeeBps;
  snapshot.liquidBalance = vault.liquidBalance;
  snapshot.outstandingExposure = vault.outstandingExposure;
  snapshot.blockNumber = event.block.number;
  snapshot.timestamp = event.block.timestamp;
  snapshot.save();
}

/** A deterministic id for an event-derived entity. */
export function eventId(event: ethereum.Event): Bytes {
  return event.transaction.hash.concatI32(event.logIndex.toI32());
}
