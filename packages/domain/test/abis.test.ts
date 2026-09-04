import { describe, expect, it } from 'vitest';
import { ABIS } from '../src/index.js';

/**
 * Guards the generated ABI barrel.
 *
 * A hand-copied or stale ABI fails at runtime rather than at build time, and in
 * this system it would fail against real funds. These assertions pin the
 * interface points the agent, the frontend and the settlement worker depend on,
 * so removing or renaming one breaks here first.
 */

type AbiItem = { type: string; name?: string; inputs?: Array<{ name: string; type: string }> };

function names(abi: readonly unknown[], kind: string): string[] {
  return (abi as AbiItem[]).filter((item) => item.type === kind).map((item) => item.name ?? '');
}

function inputsOf(abi: readonly unknown[], kind: string, name: string): string[] {
  const item = (abi as AbiItem[]).find((entry) => entry.type === kind && entry.name === name);
  return (item?.inputs ?? []).map((input) => input.type);
}

describe('generated ABI barrel', () => {
  it('exports every contract downstream packages consume', () => {
    expect(Object.keys(ABIS).sort()).toEqual([
      'ArcaidiaDeployer',
      'ArcaidiaIntentRouter',
      'ArcaidiaLiquidityVault',
      'MockUSDC',
      'SettlementReceiver',
    ]);
  });

  it('is non-empty for every contract', () => {
    for (const [name, abi] of Object.entries(ABIS)) {
      expect(abi.length, `${name} ABI is empty`).toBeGreaterThan(0);
    }
  });

  describe('ArcaidiaIntentRouter', () => {
    it('exposes intent creation and the canonical id quote', () => {
      const functions = names(ABIS.ArcaidiaIntentRouter, 'function');
      expect(functions).toContain('createIntent');
      expect(functions).toContain('quoteIntentId');
      expect(functions).toContain('intentExists');
      expect(functions).toContain('initialize');
    });

    /// The subgraph and the agent both decode this event; its shape is a
    /// cross-package contract, not an implementation detail.
    it('emits IntentCreated carrying everything needed to index and verify', () => {
      expect(names(ABIS.ArcaidiaIntentRouter, 'event')).toContain('IntentCreated');
      expect(inputsOf(ABIS.ArcaidiaIntentRouter, 'event', 'IntentCreated')).toEqual([
        'bytes32', // intentId
        'address', // sender
        'address', // recipient
        'address', // inputToken
        'uint256', // amount
        'uint256', // sourceChainId
        'uint256', // destinationChainId
        'uint16', // maxFeeBps
        'uint64', // deadline
        'uint256', // nonce
        'bytes32', // settlementRef
      ]);
    });
  });

  describe('ArcaidiaLiquidityVault', () => {
    it('exposes the ERC-4626 surface the agent prices against', () => {
      const functions = names(ABIS.ArcaidiaLiquidityVault, 'function');
      for (const fn of [
        'deposit',
        'redeem',
        'withdraw',
        'totalAssets',
        'availableLiquidity',
        'outstandingExposure',
        'utilisationBps',
        'reserveFloor',
      ]) {
        expect(functions, `missing ${fn}`).toContain(fn);
      }
    });

    it('exposes the fill registry the settlement receiver depends on', () => {
      const functions = names(ABIS.ArcaidiaLiquidityVault, 'function');
      expect(functions).toContain('isFilled');
      expect(functions).toContain('advancedPrincipal');
      expect(functions).toContain('recordReimbursement');
    });
  });

  describe('SettlementReceiver', () => {
    it('exposes settlement routing and its onchain record', () => {
      const functions = names(ABIS.SettlementReceiver, 'function');
      expect(functions).toContain('settle');
      expect(functions).toContain('isSettled');
      expect(functions).toContain('outcomeOf');
    });

    /// Both branches are separately indexed, because the two settlement
    /// outcomes are independently observable facts.
    it('emits a distinct event per settlement outcome', () => {
      const events = names(ABIS.SettlementReceiver, 'event');
      expect(events).toContain('LpReimbursed');
      expect(events).toContain('RecipientPaidByFallback');
    });
  });
});
