/**
 * Deployed protocol addresses, per chain.
 *
 * Written by the deployment script and committed, so the frontend, the agent and
 * the settlement worker all read one source rather than each carrying its own
 * copy of an address.
 *
 * `intentRouter` has been live since 2026-09-09 (contracts/script/DeployCctpRouter.s.sol,
 * wiring in the real CCTP transport) and is unchanged by the redeploy below —
 * neither the vault nor the settlement receiver was ever router-aware.
 *
 * `liquidityVault` and `settlementReceiver` were replaced 2026-09-10
 * (contracts/script/DeployVaultV2.s.sol, WP-12): the vault's fill/exposure caps
 * became a live percentage of vault depth rather than flat absolutes an owner
 * had to remember to set (see ArcaidiaLiquidityVault's DEFAULT_MAX_*_BPS) — a
 * storage-layout change with no upgrade path, so both moved to new addresses.
 * The originals (vault `0x9F5813cD0Ea34403f78769076043436E67736da3`, receiver
 * `0xb634d0fDa74BacF730B1eF50a32b4c83f13f11fC`) still exist onchain, still
 * settle their own pending intents via canonical CCTP, but are retired —
 * nothing should reference them going forward, and no new LP deposits or
 * fills should target them. The router at `0x7E4443B9215354e1819ECAA1E4CEDe8A6Fb63357`
 * is separately retired since 2026-09-09, for the same "no upgrade path"
 * reason, one redeploy earlier. Broadcast tx hashes under
 * contracts/broadcast/{Deploy,DeployCctpRouter,DeployVaultV2}.s.sol/<chainId>/run-latest.json.
 */

import type { Address } from '../types/primitives.js';
import type { ChainKey, ProtocolContracts, TokenConfig } from './chains.js';

export const DEPLOYMENTS: Readonly<Record<ChainKey, ProtocolContracts>> = {
  'ethereum-sepolia': {
    intentRouter: '0x58868465d14e0694d033bD511588AE90482b21CC',
    liquidityVault: '0xc74E693938DfBf7c11b787bA27cddE4c0215AAF1',
    settlementReceiver: '0x9a47a161ea8328b96Ad976264d42790881570E71',
    settlementInitiator: '0x7C84CB7bb7fB261F579eD5Fc3956c504C640F5Ba',
  },
  'arc-testnet': {
    intentRouter: '0x58868465d14e0694d033bD511588AE90482b21CC',
    liquidityVault: '0xc74E693938DfBf7c11b787bA27cddE4c0215AAF1',
    settlementReceiver: '0x9a47a161ea8328b96Ad976264d42790881570E71',
    settlementInitiator: '0x0caE5879B7d6f8FB02e7a9D932Ee2CcF267C6ca0',
  },
} as const;

/**
 * The CREATE2-parity protocol contracts. `intentMarket`/`vaultFactory` are the v2
 * additions (WP-26) and are unset until the coordinated redeploy (WP-31) commits them;
 * the parity check below simply has nothing to compare until then.
 */
export const PROTOCOL_CONTRACT_NAMES = [
  'intentRouter',
  'liquidityVault',
  'settlementReceiver',
  'intentMarket',
  'vaultFactory',
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
