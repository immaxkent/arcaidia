/**
 * Deployed protocol addresses, per chain.
 *
 * Written by the deployment script and committed, so the frontend, the agent and
 * the settlement worker all read one source rather than each carrying its own
 * copy of an address.
 *
 * `liquidityVault` and `settlementReceiver` are live since 2026-09-08
 * (contracts/script/Deploy.s.sol). `intentRouter` was replaced 2026-09-09
 * (contracts/script/DeployCctpRouter.s.sol) to wire in the real CCTP transport —
 * the original router at 0x7E4443B9215354e1819ECAA1E4CEDe8A6Fb63357 still exists
 * onchain but is retired; nothing should reference it going forward. The vault
 * and settlement receiver were untouched by that redeploy (neither stores or
 * checks a router address). Broadcast tx hashes under
 * contracts/broadcast/{Deploy,DeployCctpRouter}.s.sol/<chainId>/run-latest.json.
 */

import type { Address } from '../types/primitives.js';
import type { ChainKey, ProtocolContracts, TokenConfig } from './chains.js';

export const DEPLOYMENTS: Readonly<Record<ChainKey, ProtocolContracts>> = {
  'ethereum-sepolia': {
    intentRouter: '0x58868465d14e0694d033bD511588AE90482b21CC',
    liquidityVault: '0x9F5813cD0Ea34403f78769076043436E67736da3',
    settlementReceiver: '0xb634d0fDa74BacF730B1eF50a32b4c83f13f11fC',
    settlementInitiator: '0x7C84CB7bb7fB261F579eD5Fc3956c504C640F5Ba',
  },
  'arc-testnet': {
    intentRouter: '0x58868465d14e0694d033bD511588AE90482b21CC',
    liquidityVault: '0x9F5813cD0Ea34403f78769076043436E67736da3',
    settlementReceiver: '0xb634d0fDa74BacF730B1eF50a32b4c83f13f11fC',
    settlementInitiator: '0x0caE5879B7d6f8FB02e7a9D932Ee2CcF267C6ca0',
  },
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
  chainOverrides.clear();
}

/** The addresses in force for a chain: an override if one is registered, else the committed record. */
export function deploymentFor(chain: ChainKey): ProtocolContracts {
  return overrides.get(chain) ?? DEPLOYMENTS[chain];
}

/**
 * Chain-level overrides for local runs.
 *
 * A local chain has its own RPC and its own freshly deployed MockUSDC, neither
 * of which can be known at commit time. Overriding them here keeps the solver,
 * the verifier and the settlement worker on one code path: they read chain
 * configuration exactly as they do in production, and only the values differ.
 *
 * The alternative — a branch that reads local addresses in "test mode" — would
 * mean the code exercised locally is not the code that ships.
 */
export interface ChainOverride {
  readonly rpcUrl?: string;
  readonly settlementAsset?: TokenConfig;
}

const chainOverrides = new Map<ChainKey, ChainOverride>();

export function registerChainOverride(chain: ChainKey, override: ChainOverride): void {
  chainOverrides.set(chain, override);
}

export function chainOverrideFor(chain: ChainKey): ChainOverride | undefined {
  return chainOverrides.get(chain);
}
