import { afterEach, describe, expect, it } from 'vitest';
import { ABIS, CHAINS, registerDeployment, resetDeployments } from '../packages/domain/src/index.js';
import { PLACEHOLDER, START_BLOCKS, eventSignature, manifest } from './generate-subgraph.js';

/**
 * `manifest()` is pure (no file I/O), so these exercise it directly against
 * both the real committed deployment record and simulated not-yet-deployed
 * chains, without ever touching the filesystem or the CLI's --check flow.
 */
describe('manifest (v2)', () => {
  afterEach(() => resetDeployments());

  it('a deployed chain gets real addresses for router, factory and receiver, plus the vault template', () => {
    registerDeployment('ethereum-sepolia', {
      intentRouter: '0x1111111111111111111111111111111111111111',
      vaultFactory: '0x2222222222222222222222222222222222222222',
      settlementReceiver: '0x3333333333333333333333333333333333333333',
      liquidityVault: '0x4444444444444444444444444444444444444444',
      intentMarket: '0x5555555555555555555555555555555555555555',
    });
    const yaml = manifest(CHAINS['ethereum-sepolia']);

    expect(yaml).toContain('network: sepolia');
    expect(yaml).toContain('address: "0x1111111111111111111111111111111111111111"');
    expect(yaml).toContain('address: "0x2222222222222222222222222222222222222222"');
    expect(yaml).toContain('address: "0x3333333333333333333333333333333333333333"');
    // The House Vault is not a fixed data source: the factory's VaultCreated instantiates it.
    expect(yaml).not.toContain('0x4444444444444444444444444444444444444444');
    expect(yaml).toContain('templates:');
    expect(yaml).toContain('name: ArcaidiaLiquidityVault');
    expect(yaml).toContain('handler: handleVaultCreated');
    expect(yaml).not.toContain(PLACEHOLDER);
  });

  it('an undeployed chain falls back to the placeholder address, not a crash', () => {
    registerDeployment('arc-testnet', {});
    const yaml = manifest(CHAINS['arc-testnet']);

    const placeholderCount = yaml.split(`address: "${PLACEHOLDER}"`).length - 1;
    expect(placeholderCount).toBe(3);
    expect(yaml).toContain('network: arc-testnet');
    expect(yaml).toContain(`startBlock: ${START_BLOCKS['arc-testnet']}`);
  });

  it('a partially deployed chain only placeholders the missing contracts', () => {
    registerDeployment('arc-testnet', {
      intentRouter: '0x1111111111111111111111111111111111111111',
      // vaultFactory, settlementReceiver deliberately left unset.
    });
    const yaml = manifest(CHAINS['arc-testnet']);

    expect(yaml).toContain('address: "0x1111111111111111111111111111111111111111"');
    const placeholderCount = yaml.split(`address: "${PLACEHOLDER}"`).length - 1;
    expect(placeholderCount).toBe(2);
  });

  /// The whole point of WP-27's generator change: signatures come from the ABI, so a contract
  /// change that alters an event's parameters changes the manifest automatically — and
  /// `subgraph:check` then flags the committed manifest as stale.
  it('derives every event signature from the ABI, including tuples and indexed params', () => {
    expect(eventSignature(ABIS.ArcaidiaIntentRouter, 'IntentCreated')).toBe(
      'IntentCreated(indexed bytes32,indexed address,indexed address,uint8,address,uint256,uint256,uint256,uint16,uint64,uint256,address,uint256,bytes32)',
    );
    expect(eventSignature(ABIS.ArcaidiaVaultFactory, 'VaultCreated')).toBe(
      'VaultCreated(indexed address,indexed address,string,(uint16,uint16,uint16,uint16,uint16,uint16,uint16),uint16,uint16,uint16)',
    );
    expect(eventSignature(ABIS.SettlementReceiver, 'LpReimbursed')).toBe(
      'LpReimbursed(indexed bytes32,indexed address,uint256)',
    );
    expect(eventSignature(ABIS.ArcaidiaLiquidityVault, 'FastFilled')).toBe(
      'FastFilled(indexed bytes32,indexed address,indexed address,uint256,uint256,uint256,uint16)',
    );
    expect(() => eventSignature(ABIS.ArcaidiaIntentRouter, 'NoSuchEvent')).toThrow(/No event/);
  });

  it('every handler the manifest names exists in the v2 ABI', () => {
    const yaml = manifest(CHAINS['ethereum-sepolia']);
    const events = [...yaml.matchAll(/- event: ([A-Za-z]+)\(/g)].map((m) => m[1]);
    expect(events).toEqual(
      expect.arrayContaining([
        'IntentCreated',
        'VaultCreated',
        'FastFilled',
        'DeliveredViaSwap',
        'SwapFellBack',
        'SettledWithProof',
        'HeldForVault',
      ]),
    );
  });
});
