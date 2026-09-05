import { BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts';
import { ProtocolState, Vault } from '../generated/schema';

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
    state.intentsCreated = BigInt.zero();
    state.intentsFilled = BigInt.zero();
    state.intentsSettled = BigInt.zero();
    state.pendingSettlementValue = BigInt.zero();
    state.oldestUnsettledTimestamp = BigInt.zero();
    state.totalFeesEarned = BigInt.zero();
  }

  state.updatedAtBlock = event.block.number;
  state.updatedAtTimestamp = event.block.timestamp;
  return state as ProtocolState;
}

export function vaultState(event: ethereum.Event): Vault {
  let vault = Vault.load(event.address);

  if (vault == null) {
    vault = new Vault(event.address);
    vault.chainId = BigInt.zero();
    vault.asset = Bytes.empty();
    vault.liquidBalance = BigInt.zero();
    vault.outstandingExposure = BigInt.zero();
    vault.accruedProtocolFees = BigInt.zero();
    vault.totalDeposited = BigInt.zero();
    vault.totalWithdrawn = BigInt.zero();
    vault.fillCount = BigInt.zero();
    vault.paused = false;
  }

  vault.updatedAtBlock = event.block.number;
  vault.updatedAtTimestamp = event.block.timestamp;
  return vault as Vault;
}

/** A deterministic id for an event-derived entity. */
export function eventId(event: ethereum.Event): Bytes {
  return event.transaction.hash.concatI32(event.logIndex.toI32());
}
