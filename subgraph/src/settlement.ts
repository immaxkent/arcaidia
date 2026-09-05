import { BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts';
import {
  LpReimbursed,
  RecipientPaidByFallback,
} from '../generated/SettlementReceiver/SettlementReceiver';
import { Intent, Settlement } from '../generated/schema';
import { eventId, protocolState } from './shared';

const ONE = BigInt.fromI32(1);

/**
 * Canonical settlement, recorded on the destination chain.
 *
 * Two events, two outcomes, indexed separately. Collapsing them would erase the
 * distinction between "the liquidity provider was repaid" and "nobody
 * fast-filled, so the user was paid directly" — opposite facts about whether
 * the fast path did anything at all.
 */
function record(
  id: Bytes,
  intentId: Bytes,
  outcome: string,
  amount: BigInt,
  event: ethereum.Event,
): void {
  const settlement = new Settlement(id);
  settlement.intentId = intentId;
  settlement.outcome = outcome;
  settlement.amount = amount;
  settlement.blockNumber = event.block.number;
  settlement.timestamp = event.block.timestamp;
  settlement.txHash = event.transaction.hash;
  settlement.save();

  // The intent lives on the other chain's deployment unless this chain created
  // it too, so this is a best-effort local join rather than the join.
  const intent = Intent.load(intentId);
  if (intent != null) {
    intent.canonicalStatus = 'SETTLED';
    intent.settlement = settlement.id;
    intent.save();
  }

  const state = protocolState(event);
  state.intentsSettled = state.intentsSettled.plus(ONE);
  state.save();
}

export function handleLpReimbursed(event: LpReimbursed): void {
  record(eventId(event), event.params.intentId, 'LP_REIMBURSED', event.params.amount, event);
}

export function handleRecipientPaidByFallback(event: RecipientPaidByFallback): void {
  record(eventId(event), event.params.intentId, 'RECIPIENT_FALLBACK', event.params.amount, event);
}
