import { BigInt } from '@graphprotocol/graph-ts';
import { IntentCreated } from '../generated/ArcaidiaIntentRouter/ArcaidiaIntentRouter';
import { Intent } from '../generated/schema';
import { protocolState } from './shared';

const ONE = BigInt.fromI32(1);

/**
 * An intent, as recorded on the chain it was created on.
 *
 * The two settlement statuses start independently and stay independent. Nothing
 * in this subgraph collapses them, because no honest single answer exists to
 * "is this transfer done?" — the recipient and the liquidity provider are
 * waiting for different things.
 */
export function handleIntentCreated(event: IntentCreated): void {
  const intent = new Intent(event.params.intentId);

  intent.sender = event.params.sender;
  intent.recipient = event.params.recipient;
  intent.inputToken = event.params.inputToken;
  intent.amount = event.params.amount;
  intent.sourceChainId = event.params.sourceChainId;
  intent.destinationChainId = event.params.destinationChainId;
  intent.maxFeeBps = event.params.maxFeeBps;
  intent.deadline = event.params.deadline;
  intent.nonce = event.params.nonce;
  intent.settlementRef = event.params.settlementRef;

  intent.fastStatus = 'PENDING';
  intent.canonicalStatus = 'PENDING';

  intent.createdAtBlock = event.block.number;
  intent.createdAtTimestamp = event.block.timestamp;
  intent.createdTxHash = event.transaction.hash;

  intent.save();

  const state = protocolState(event);
  state.chainId = event.params.sourceChainId;
  state.intentsCreated = state.intentsCreated.plus(ONE);
  state.save();
}
