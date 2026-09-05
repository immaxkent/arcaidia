import { afterEach, describe, expect, it } from 'vitest';
import {
  CHAINS,
  DEPLOYMENTS,
  PROTOCOL_CONTRACT_NAMES,
  deployedAddresses,
  chainConfig,
  deploymentFor,
  findChain,
  registerChainOverride,
  registerDeployment,
  resetDeployments,
  type ProtocolContractName,
} from '../src/index.js';

/**
 * Guards deployed addresses.
 *
 * The parity assertion is the important one: Arcaidia deploys through CREATE2
 * with identical init code and salts, so the moment a contract exists on more
 * than one chain its addresses must match. This turns that from a claim in a
 * README into a test that fails the day it stops being true.
 */

describe('deployments', () => {
  it('has an entry for every configured chain', () => {
    expect(Object.keys(DEPLOYMENTS).sort()).toEqual(Object.keys(CHAINS).sort());
  });

  it('feeds chain configuration rather than being a second source of truth', () => {
    for (const chain of Object.values(CHAINS)) {
      expect(chain.contracts).toBe(DEPLOYMENTS[chain.key]);
    }
  });

  it.each(PROTOCOL_CONTRACT_NAMES)('records %s as a valid address wherever it is set', (contract) => {
    for (const { address } of deployedAddresses(contract)) {
      expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(address).not.toBe('0x0000000000000000000000000000000000000000');
    }
  });

  it.each(PROTOCOL_CONTRACT_NAMES)(
    'gives %s the same address on every chain it is deployed to',
    (contract: ProtocolContractName) => {
      const deployed = deployedAddresses(contract);
      if (deployed.length < 2) return; // nothing to compare yet

      const unique = new Set(deployed.map((entry) => entry.address.toLowerCase()));
      expect(
        unique.size,
        `${contract} has diverged across chains: ${JSON.stringify(deployed)}`,
      ).toBe(1);
    },
  );

  it('is empty until the deployment has run', () => {
    // A deliberate tripwire: when this starts failing, WP-01's deployment has
    // happened and the README's address table needs updating alongside it.
    const total = PROTOCOL_CONTRACT_NAMES.flatMap((name) => deployedAddresses(name)).length;
    expect(total).toBe(0);
  });
});

describe('deployment overrides', () => {
  const ROUTER = '0x1111111111111111111111111111111111111111' as const;

  afterEach(() => resetDeployments());

  it('falls back to the committed record when nothing is registered', () => {
    expect(deploymentFor('arc-testnet')).toEqual(DEPLOYMENTS['arc-testnet']);
  });

  it('returns a registered override', () => {
    registerDeployment('arc-testnet', { intentRouter: ROUTER });
    expect(deploymentFor('arc-testnet').intentRouter).toBe(ROUTER);
  });

  it('leaves other chains untouched', () => {
    registerDeployment('arc-testnet', { intentRouter: ROUTER });
    expect(deploymentFor('ethereum-sepolia')).toEqual(DEPLOYMENTS['ethereum-sepolia']);
  });

  it('restores the committed record on reset', () => {
    registerDeployment('arc-testnet', { intentRouter: ROUTER });
    resetDeployments();
    expect(deploymentFor('arc-testnet')).toEqual(DEPLOYMENTS['arc-testnet']);
  });

  /// The committed record is what ships; overrides exist so local runs need no
  /// second code path, not so production can be reconfigured at runtime.
  it('does not alter the committed record', () => {
    registerDeployment('arc-testnet', { intentRouter: ROUTER });
    expect(DEPLOYMENTS['arc-testnet'].intentRouter).toBeUndefined();
  });
});

describe('chain overrides', () => {
  const LOCAL_USDC = '0x9999999999999999999999999999999999999999' as const;

  afterEach(() => resetDeployments());

  it('returns the committed configuration when nothing is overridden', () => {
    expect(chainConfig('arc-testnet').rpcUrl).toBe(CHAINS['arc-testnet'].rpcUrl);
    expect(chainConfig('arc-testnet').settlementAsset).toBe(CHAINS['arc-testnet'].settlementAsset);
  });

  it('applies an RPC override', () => {
    registerChainOverride('arc-testnet', { rpcUrl: 'http://127.0.0.1:8546' });
    expect(chainConfig('arc-testnet').rpcUrl).toBe('http://127.0.0.1:8546');
  });

  /// A local run deploys its own MockUSDC, whose address cannot be known at
  /// commit time. Overriding it keeps verification on one code path.
  it('applies a settlement asset override', () => {
    registerChainOverride('arc-testnet', {
      settlementAsset: { address: LOCAL_USDC, symbol: 'USDC', decimals: 6 },
    });
    expect(chainConfig('arc-testnet').settlementAsset.address).toBe(LOCAL_USDC);
  });

  it('leaves other chains untouched', () => {
    registerChainOverride('arc-testnet', { rpcUrl: 'http://127.0.0.1:8546' });
    expect(chainConfig('ethereum-sepolia').rpcUrl).toBe(CHAINS['ethereum-sepolia'].rpcUrl);
  });

  it('reaches lookups by chain id, not only by key', () => {
    registerChainOverride('arc-testnet', { rpcUrl: 'http://127.0.0.1:8546' });
    expect(findChain(5042002)?.rpcUrl).toBe('http://127.0.0.1:8546');
  });

  it('is cleared by resetDeployments', () => {
    registerChainOverride('arc-testnet', { rpcUrl: 'http://127.0.0.1:8546' });
    resetDeployments();
    expect(chainConfig('arc-testnet').rpcUrl).toBe(CHAINS['arc-testnet'].rpcUrl);
  });
});
