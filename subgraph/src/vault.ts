import { BigInt } from '@graphprotocol/graph-ts';
import {
  Deposit,
  FastFilled,
  FeesAccrued,
  PausedSet,
  ReimbursementRecorded,
  Withdraw,
} from '../generated/ArcaidiaLiquidityVault/ArcaidiaLiquidityVault';
import { Fill, Intent } from '../generated/schema';
import { eventId, protocolState, vaultState } from './shared';

const ONE = BigInt.fromI32(1);

/**
 * A fill, recorded on the *destination* chain.
 *
 * The intent itself was created on the other chain, so it usually does not
 * exist in this deployment's store. The fill therefore stands alone, keyed by
 * `intentId`, and `GraphObservationProvider` joins the two views. Fabricating a
 * local Intent here would invent a record of something this chain never saw.
 */
export function handleFastFilled(event: FastFilled): void {
  const fill = new Fill(eventId(event));
  fill.intentId = event.params.intentId;
  fill.recipient = event.params.recipient;
  fill.outputAmount = event.params.outputAmount;
  fill.signer = event.params.signer;
  fill.blockNumber = event.block.number;
  fill.timestamp = event.block.timestamp;
  fill.txHash = event.transaction.hash;
  fill.save();

  // Only if this chain happens to hold the intent too.
  const intent = Intent.load(event.params.intentId);
  if (intent != null) {
    intent.fastStatus = 'FAST_FILLED';
    intent.fill = fill.id;
    intent.save();
  }

  const vault = vaultState(event);
  vault.outstandingExposure = vault.outstandingExposure.plus(event.params.outputAmount);
  vault.liquidBalance = vault.liquidBalance.minus(event.params.outputAmount);
  vault.fillCount = vault.fillCount.plus(ONE);
  vault.save();

  const state = protocolState(event);
  state.intentsFilled = state.intentsFilled.plus(ONE);
  state.pendingSettlementValue = state.pendingSettlementValue.plus(event.params.outputAmount);
  // The oldest outstanding advance only moves when there was nothing outstanding.
  if (state.oldestUnsettledTimestamp.equals(BigInt.zero())) {
    state.oldestUnsettledTimestamp = event.block.timestamp;
  }
  state.save();
}

export function handleDeposit(event: Deposit): void {
  const vault = vaultState(event);
  vault.liquidBalance = vault.liquidBalance.plus(event.params.assets);
  vault.totalDeposited = vault.totalDeposited.plus(event.params.assets);
  vault.save();
}

export function handleWithdraw(event: Withdraw): void {
  const vault = vaultState(event);
  vault.liquidBalance = vault.liquidBalance.minus(event.params.assets);
  vault.totalWithdrawn = vault.totalWithdrawn.plus(event.params.assets);
  vault.save();
}

export function handleReimbursement(event: ReimbursementRecorded): void {
  const vault = vaultState(event);
  vault.liquidBalance = vault.liquidBalance.plus(event.params.amountReceived);
  vault.outstandingExposure = vault.outstandingExposure.minus(event.params.exposureCleared);
  vault.save();

  const state = protocolState(event);
  state.pendingSettlementValue = state.pendingSettlementValue.minus(event.params.exposureCleared);
  // With nothing outstanding there is no oldest advance to report. While work
  // remains this stays at the first outstanding fill's timestamp, which
  // overstates the age slightly and is the safe direction to be wrong in.
  if (state.pendingSettlementValue.le(BigInt.zero())) {
    state.oldestUnsettledTimestamp = BigInt.zero();
  }
  state.save();
}

export function handleFeesAccrued(event: FeesAccrued): void {
  const vault = vaultState(event);
  vault.accruedProtocolFees = vault.accruedProtocolFees.plus(event.params.toProtocol);
  vault.save();

  const state = protocolState(event);
  state.totalFeesEarned = state.totalFeesEarned
    .plus(event.params.toProtocol)
    .plus(event.params.toLps);
  state.save();
}

export function handlePausedSet(event: PausedSet): void {
  const vault = vaultState(event);
  vault.paused = event.params.paused;
  vault.save();
}
