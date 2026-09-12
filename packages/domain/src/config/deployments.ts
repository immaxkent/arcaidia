/**
 * Deployed protocol addresses, per chain.
 *
 * Written by the deployment script and committed, so the frontend, the agent and
 * the settlement worker all read one source rather than each carrying its own
 * copy of an address.
 *
 * **v2 — deployed 2026-09-12 (WP-31, contracts/script/Deploy.s.sol, `arcaidia.v2.*` salts).**
 * Five CREATE2 contracts at identical addresses on both chains: the intent router
 * (schema v1.1 intents, CCTP intent hook), the House Vault (created *through* the
 * factory like any participant's vault, D10), the settlement receiver
 * (`settleWithProof`, D8), the intent market (factory-vaults-only claims, D11) and the
 * vault factory. `settlementInitiator` is this chain's own `CircleCCTPInitiator` v2 —
 * plain `new`, so different per chain (Sepolia block 11688301, Arc block 61715950).
 *
 * **Retired, all still onchain and still settling their own already-pending intents via
 * canonical CCTP, but nothing may reference them for new deposits or fills:**
 * - v1 router `0x58868465d14e0694d033bD511588AE90482b21CC` (2026-09-09, WP-10) and its
 *   initiators Sepolia `0x7C84CB7bb7fB261F579eD5Fc3956c504C640F5Ba` / Arc
 *   `0x0caE5879B7d6f8FB02e7a9D932Ee2CcF267C6ca0` — no `hookData`, cannot serve the v2 router;
 * - v1 vault `0xc74E693938DfBf7c11b787bA27cddE4c0215AAF1` + receiver
 *   `0x9a47a161ea8328b96Ad976264d42790881570E71` (2026-09-10, WP-12) — no fee policy, no market;
 * - the originals: vault `0x9F5813cD0Ea34403f78769076043436E67736da3`, receiver
 *   `0xb634d0fDa74BacF730B1eF50a32b4c83f13f11fC`, router `0x7E4443B9215354e1819ECAA1E4CEDe8A6Fb63357`
 *   (2026-09-08/09).
 * Broadcast tx hashes under contracts/broadcast/Deploy.s.sol/<chainId>/run-latest.json.
 */

import type { Address } from '../types/primitives.js';
import type { ChainKey, ProtocolContracts, TokenConfig } from './chains.js';

export const DEPLOYMENTS: Readonly<Record<ChainKey, ProtocolContracts>> = {
  'ethereum-sepolia': {
    intentRouter: '0x69946FFBBE5f250C7357b89E4072F9eAfc1c3ee6',
    liquidityVault: '0xB4bA190D5C78869366e7963f5CcCf4c3167d855C',
    settlementReceiver: '0x8B93b54d6Df61E9422D14C309F3c9Ab950b920Cd',
    intentMarket: '0x81d94f5149FC86df7A273A720070300C461DcA08',
    vaultFactory: '0xD458d83C874296EC4a29c47655Ae47302879b23a',
    settlementInitiator: '0x01F7925189200e87F0FC48e275a425a0E4B3b827',
  },
  'arc-testnet': {
    intentRouter: '0x69946FFBBE5f250C7357b89E4072F9eAfc1c3ee6',
    liquidityVault: '0xB4bA190D5C78869366e7963f5CcCf4c3167d855C',
    settlementReceiver: '0x8B93b54d6Df61E9422D14C309F3c9Ab950b920Cd',
    intentMarket: '0x81d94f5149FC86df7A273A720070300C461DcA08',
    vaultFactory: '0xD458d83C874296EC4a29c47655Ae47302879b23a',
    settlementInitiator: '0x6095944456C20A0acF7c44e4ff40DEa8f041d9b3',
  },
} as const;

/**
 * The CREATE2-parity protocol contracts — all five live at one address on both chains
 * since the 2026-09-12 v2 deployment (WP-31).
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
