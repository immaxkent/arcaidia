import { BigInt } from '@graphprotocol/graph-ts';
import { VaultCreated } from '../generated/ArcaidiaVaultFactory/ArcaidiaVaultFactory';
import { ArcaidiaLiquidityVault as VaultTemplate } from '../generated/templates';
import { Vault } from '../generated/schema';
import { protocolState, refreshFeeTier } from './shared';

const ONE = BigInt.fromI32(1);

/**
 * The vault directory (D10). A vault exists to this subgraph when the factory
 * says so — nothing is derived from fill history — and the template it
 * instantiates is what indexes that vault's own events from this block on.
 */
export function handleVaultCreated(event: VaultCreated): void {
  const vault = new Vault(event.params.vault);
  vault.chainId = BigInt.zero(); // set on the first intent seen; the factory event carries no chain id
  vault.asset = event.address; // overwritten below once the vault emits; placeholder never read alone
  vault.owner = event.params.owner;
  vault.label = event.params.label;
  vault.createdVia = 'FACTORY';
  vault.createdAtBlock = event.block.number;
  vault.createdAtTimestamp = event.block.timestamp;

  const policy = event.params.policy;
  vault.baseFeeBps = policy.baseFeeBps;
  vault.midFeeBps = policy.midFeeBps;
  vault.highFeeBps = policy.highFeeBps;
  vault.criticalFeeBps = policy.criticalFeeBps;
  vault.midThresholdBps = policy.midThresholdBps;
  vault.highThresholdBps = policy.highThresholdBps;
  vault.criticalThresholdBps = policy.criticalThresholdBps;
  vault.reserveFloorBps = event.params.reserveFloorBps;
  vault.maxFillBps = event.params.maxFillBps;
  vault.maxExposureBps = event.params.maxExposureBps;

  vault.liquidBalance = BigInt.zero();
  vault.outstandingExposure = BigInt.zero();
  vault.accruedProtocolFees = BigInt.zero();
  vault.totalDeposited = BigInt.zero();
  vault.totalWithdrawn = BigInt.zero();
  vault.fillCount = BigInt.zero();
  vault.totalFeesEarned = BigInt.zero();
  vault.paused = false;
  vault.updatedAtBlock = event.block.number;
  vault.updatedAtTimestamp = event.block.timestamp;

  refreshFeeTier(vault, event);
  vault.save();

  VaultTemplate.create(event.params.vault);

  const state = protocolState(event);
  state.vaultCount = state.vaultCount.plus(ONE);
  state.save();
}
