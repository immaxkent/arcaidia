import { BigInt, Bytes } from '@graphprotocol/graph-ts';
import {
  DeliveredViaSwap,
  Deposit,
  FastFilled,
  FeesAccrued,
  PausedSet,
  ReimbursementRecorded,
  SwapFellBack,
  VaultInitialized,
  Withdraw,
} from '../generated/templates/ArcaidiaLiquidityVault/ArcaidiaLiquidityVault';
import { Fill, Intent } from '../generated/schema';
import { eventId, protocolState, refreshFeeTier, vaultState } from './shared';

const ONE = BigInt.fromI32(1);

export function handleVaultInitialized(event: VaultInitialized): void {
  const vault = vaultState(event);
  vault.asset = event.params.asset;
  vault.save();
}

/**
 * A fill, recorded on the *destination* chain.
 *
 * The intent itself was created on the other chain, so it usually does not
 * exist in this deployment's store. The fill therefore stands alone, keyed by
 * `intentId`, and `GraphObservationProvider` joins the two views. Fabricating a
 * local Intent here would invent a record of something this chain never saw.
 *
 * `FastFilled` fires after `DeliveredViaSwap`/`SwapFellBack` in the same
 * transaction (the vault emits delivery inside `_recordFastFill`), so those two
 * handlers create the Fill with its delivery path and this one fills in the rest.
 */
export function handleFastFilled(event: FastFilled): void {
  const fillId = fillIdFor(event.params.intentId, event.address);
  let fill = Fill.load(fillId);
  if (fill == null) {
    fill = new Fill(fillId);
    fill.deliveredVia = 'USDC';
  }
  fill.intentId = event.params.intentId;
  fill.vault = event.address;
  fill.recipient = event.params.recipient;
  fill.inputAmount = event.params.inputAmount;
  fill.outputAmount = event.params.outputAmount;
  fill.feeAmount = event.params.feeAmount;
  fill.feeBps = event.params.feeBps;
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
  refreshFeeTier(vault, event);
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

export function handleDeliveredViaSwap(event: DeliveredViaSwap): void {
  const fill = fillFor(event.params.intentId, event.address);
  fill.deliveredVia = 'SWAP';
  fill.tokenOut = event.params.tokenOut;
  fill.amountOut = event.params.amountOut;
  fill.save();
}

export function handleSwapFellBack(event: SwapFellBack): void {
  const fill = fillFor(event.params.intentId, event.address);
  fill.deliveredVia = 'SWAP_FALLBACK';
  fill.tokenOut = event.params.tokenOut;
  fill.amountOut = event.params.usdcDelivered;
  fill.save();
}

export function handleDeposit(event: Deposit): void {
  const vault = vaultState(event);
  vault.liquidBalance = vault.liquidBalance.plus(event.params.assets);
  vault.totalDeposited = vault.totalDeposited.plus(event.params.assets);
  refreshFeeTier(vault, event);
  vault.save();
}

export function handleWithdraw(event: Withdraw): void {
  const vault = vaultState(event);
  vault.liquidBalance = vault.liquidBalance.minus(event.params.assets);
  vault.totalWithdrawn = vault.totalWithdrawn.plus(event.params.assets);
  refreshFeeTier(vault, event);
  vault.save();
}

export function handleReimbursement(event: ReimbursementRecorded): void {
  const vault = vaultState(event);
  vault.liquidBalance = vault.liquidBalance.plus(event.params.amountReceived);
  vault.outstandingExposure = vault.outstandingExposure.minus(event.params.exposureCleared);
  refreshFeeTier(vault, event);
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
  vault.totalFeesEarned = vault.totalFeesEarned.plus(event.params.toProtocol).plus(event.params.toLps);
  refreshFeeTier(vault, event);
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

/** One Fill per (intent, vault): the market guarantees one winner, so this is one per intent in practice. */
function fillIdFor(intentId: Bytes, vault: Bytes): Bytes {
  return intentId.concat(vault);
}

function fillFor(intentId: Bytes, vault: Bytes): Fill {
  const id = fillIdFor(intentId, vault);
  let fill = Fill.load(id);
  if (fill == null) {
    fill = new Fill(id);
    fill.intentId = intentId;
    fill.vault = vault;
    fill.deliveredVia = 'USDC';
  }
  return fill as Fill;
}

