import { describe, expect, it } from 'vitest';
import {
  CHAINS,
  DEPLOYMENTS,
  PROTOCOL_CONTRACT_NAMES,
  deployedAddresses,
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
