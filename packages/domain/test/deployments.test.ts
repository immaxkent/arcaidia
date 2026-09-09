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

  it('is live on both chains, at the same address, since the 2026-09-08 deployment', () => {
    for (const name of PROTOCOL_CONTRACT_NAMES) {
      const deployed = deployedAddresses(name);
      expect(deployed.map((d) => d.chain).sort()).toEqual(['arc-testnet', 'ethereum-sepolia']);
      expect(new Set(deployed.map((d) => d.address.toLowerCase())).size).toBe(1);
    }
  });

  describe('settlementInitiator (WP-10)', () => {
    it('is set on both chains, since the 2026-09-09 CCTP router redeploy', () => {
      for (const chain of Object.values(CHAINS)) {
        expect(DEPLOYMENTS[chain.key].settlementInitiator).toMatch(/^0x[0-9a-fA-F]{40}$/);
      }
    });

    /// Deployed via a plain `new`, not CREATE2 — unlike the three parity-checked
    /// contracts, matching across chains is neither expected nor meaningful.
    it('is deliberately excluded from the cross-chain parity check', () => {
      expect(PROTOCOL_CONTRACT_NAMES as readonly string[]).not.toContain('settlementInitiator');
    });

    it('genuinely differs between the two chains, confirming it is not CREATE2-deployed', () => {
      const sepolia = DEPLOYMENTS['ethereum-sepolia'].settlementInitiator;
      const arc = DEPLOYMENTS['arc-testnet'].settlementInitiator;
      expect(sepolia?.toLowerCase()).not.toBe(arc?.toLowerCase());
    });
  });

  it('retired the pre-WP-10 router: the new intentRouter differs from the original mock-backed one', () => {
    const RETIRED_ROUTER = '0x7E4443B9215354e1819ECAA1E4CEDe8A6Fb63357';
    for (const chain of Object.values(CHAINS)) {
      expect(DEPLOYMENTS[chain.key].intentRouter?.toLowerCase()).not.toBe(RETIRED_ROUTER.toLowerCase());
    }
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
    const committed = DEPLOYMENTS['arc-testnet'].intentRouter;
    registerDeployment('arc-testnet', { intentRouter: ROUTER });
    expect(DEPLOYMENTS['arc-testnet'].intentRouter).toBe(committed);
    expect(DEPLOYMENTS['arc-testnet'].intentRouter).not.toBe(ROUTER);
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
