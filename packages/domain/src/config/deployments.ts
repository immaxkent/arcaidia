/**
 * Deployed protocol addresses, per chain.
 *
 * Written by the deployment script and committed, so the frontend, the agent and
 * the settlement worker all read one source rather than each carrying its own
 * copy of an address.
 *
 * Empty until WP-01's deployment runs. `resolveEndpoints` refuses to resolve a
 * route whose contracts are unset rather than handing a caller a zero address.
 */

import type { Address } from '../types/primitives.js';
import type { ChainKey, ProtocolContracts } from './chains.js';

export const DEPLOYMENTS: Readonly<Record<ChainKey, ProtocolContracts>> = {
  'ethereum-sepolia': {},
  'arc-testnet': {},
} as const;

/**
 * The three protocol contracts, in the order they are deployed.
 * Used by the parity check below and by deployment tooling.
 */
export const PROTOCOL_CONTRACT_NAMES = [
  'intentRouter',
  'liquidityVault',
  'settlementReceiver',
] as const;

export type ProtocolContractName = (typeof PROTOCOL_CONTRACT_NAMES)[number];

/**
 * Chains where a given contract has been deployed, with its address.
 *
 * Arcaidia deploys through CREATE2 with identical init code and salts, so once a
 * contract is deployed on more than one chain every entry here must carry the
 * same address. `deployments.test.ts` asserts exactly that, which turns address
 * parity from a claim in a README into a failing test the moment it stops holding.
 */
export interface DeployedAddress {
  readonly chain: ChainKey;
  readonly address: Address;
}

export function deployedAddresses(contract: ProtocolContractName): readonly DeployedAddress[] {
  const entries = Object.entries(DEPLOYMENTS) as Array<[ChainKey, ProtocolContracts]>;
  const found: DeployedAddress[] = [];

  for (const [chain, contracts] of entries) {
    const address = contracts[contract];
    if (address !== undefined) found.push({ chain, address });
  }

  return found;
}

/**
 * Runtime deployment overrides.
 *
 * `DEPLOYMENTS` above is the committed record, written by the deployment
 * script. Local runs and tests need to point the same code at addresses that do
 * not exist in a committed file — an anvil deployment, a fixture — without
 * editing source or introducing a second code path for "test mode".
 *
 * Overrides are additive and explicit: nothing is registered unless a caller
 * asks, and `resetDeployments` restores the committed record. Production reads
 * the committed record because nothing ever calls `registerDeployment`.
 */
const overrides = new Map<ChainKey, ProtocolContracts>();

export function registerDeployment(chain: ChainKey, contracts: ProtocolContracts): void {
  overrides.set(chain, contracts);
}

export function resetDeployments(): void {
  overrides.clear();
}

/** The addresses in force for a chain: an override if one is registered, else the committed record. */
export function deploymentFor(chain: ChainKey): ProtocolContracts {
  return overrides.get(chain) ?? DEPLOYMENTS[chain];
}
