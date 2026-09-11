import { BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts';
import {
  HeldForVault,
  LpReimbursed,
  RecipientPaidByFallback,
  SettledWithProof,
} from '../generated/SettlementReceiver/SettlementReceiver';
import { Intent, Settlement } from '../generated/schema';
import { protocolState } from './shared';

const ONE = BigInt.fromI32(1);

/**
 * Canonical settlement, recorded on the destination chain.
 *
 * Three outcomes, indexed separately. Collapsing them would erase the
 * distinction between "the liquidity provider was repaid", "nobody fast-filled,
 * so the user was paid directly" and "the winner could not be reimbursed yet" —
 * different facts about whether the fast path did anything at all.
 *
 * v2: `SettledWithProof` fires in the same transaction as one of the outcome
 * events when settlement came from attested bytes (D8); it marks the record
 * `viaProof` and carries the CCTP nonce. The reporter path emits only the
 * outcome event.
 */
function record(intentId: Bytes, outcome: string, amount: BigInt, event: ethereum.Event): void {
  let settlement = Settlement.load(intentId);
  const firstRecord = settlement == null;
  if (settlement == null) {
    settlement = new Settlement(intentId);
    settlement.intentId = intentId;
    settlement.viaProof = false;
  }
  settlement.outcome = outcome;
  settlement.amount = amount;
  settlement.blockNumber = event.block.number;
  settlement.timestamp = event.block.timestamp;
  settlement.txHash = event.transaction.hash;
  if (outcome != 'HELD_FOR_VAULT') settlement.heldForVault = null;
  settlement.save();

  // The intent lives on the other chain's deployment unless this chain created
  // it too, so this is a best-effort local join rather than the join.
  const intent = Intent.load(intentId);
  if (intent != null) {
    intent.canonicalStatus = 'SETTLED';
    intent.settlement = settlement.id;
    intent.save();
  }

  if (firstRecord) {
    const state = protocolState(event);
    state.intentsSettled = state.intentsSettled.plus(ONE);
    if (outcome == 'RECIPIENT_FALLBACK') state.intentsFallenBack = state.intentsFallenBack.plus(ONE);
    state.save();
  }
}

export function handleLpReimbursed(event: LpReimbursed): void {
  record(event.params.intentId, 'LP_REIMBURSED', event.params.amount, event);
}

export function handleRecipientPaidByFallback(event: RecipientPaidByFallback): void {
  record(event.params.intentId, 'RECIPIENT_FALLBACK', event.params.amount, event);
}

export function handleHeldForVault(event: HeldForVault): void {
  record(event.params.intentId, 'HELD_FOR_VAULT', event.params.amount, event);
  const settlement = Settlement.load(event.params.intentId);
  if (settlement == null) return;
  settlement.heldForVault = event.params.vault;
  settlement.save();
}

/**
 * Fires after the outcome event in the same transaction (`settleWithProof` routes first,
 * then emits), so the record already exists; a missing one would mean an event ordering
 * the contract cannot produce, and is left alone rather than fabricated.
 */
export function handleSettledWithProof(event: SettledWithProof): void {
  const settlement = Settlement.load(event.params.intentId);
  if (settlement == null) return;
  settlement.viaProof = true;
  settlement.cctpNonce = event.params.cctpNonce;
  settlement.save();
}
