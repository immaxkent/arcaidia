/**
 * Adapter boundaries (specification §17).
 *
 * Each port has a local implementation used by the deterministic lifecycle, and
 * a sponsor implementation substituted later. Substituting one must not change
 * any caller; if it would, the port is wrong and the port gets fixed.
 *
 * `AgentAuthority` is settled: the vault authenticates a recovered EIP-712 signer
 * against an allowlist (DECISIONS.md, D2). The residual risk is D3 — the Circle
 * agent wallet must be an EOA for `ecrecover` to work.
 */

import type { Address, Bytes32 } from './types/primitives.js';
import type { Intent } from './types/intent.js';
import type { FillAuthorization, SignedFillAuthorization } from './types/fill.js';
import type { SettlementHealth, SettlementReference, SettlementState, VaultState } from './types/settlement.js';

/**
 * Discovery and live state. The Graph backs this in the qualifying path; an
 * in-memory implementation backs the deterministic tests.
 *
 * Observation is not authorization. Nothing returned here is sufficient to move
 * LP funds — the agent independently re-verifies the source receipt against an
 * RPC before risking capital.
 */
export interface ObservationProvider {
  /** Intents awaiting a fast fill, newest evidence first. */
  pendingIntents(): Promise<readonly Intent[]>;
  /** Current state of one destination vault. */
  vaultState(chainId: number): Promise<VaultState>;
  /** Aggregate canonical-settlement health across both chains. */
  settlementHealth(): Promise<SettlementHealth>;
  /** Whether an intent has already been filled, per indexed state. */
  isFilled(intentId: Bytes32): Promise<boolean>;
}

/**
 * The agent's blockchain authority.
 *
 * Produces an EIP-712 signature over a `FillAuthorization`; any relayer may then
 * submit it, and the destination vault authenticates the *recovered signer*
 * against its allowlist rather than `msg.sender`. Two implementations:
 * `LocalAgentSigner` (WP-05) and `CircleAgentWalletSigner` (WP-09).
 *
 * This shape assumes the Circle agent wallet is provisioned as an **EOA**, so its
 * signature is `ecrecover`-verifiable. A smart contract account would need
 * EIP-1271 verification in the vault instead. Confirm the account type at WP-09
 * (see DECISIONS.md, D3).
 */
export interface AgentAuthority {
  /** The address the vault must allowlist. */
  readonly address: Address;
  signFillAuthorization(
    authorization: FillAuthorization,
    domain: { chainId: number; verifyingContract: Address },
  ): Promise<SignedFillAuthorization>;
}

/**
 * Canonical settlement transport. `MockSettlementAdapter` for the local
 * lifecycle, `CircleCCTPAdapter` for the qualifying path. No Circle-specific
 * type crosses this boundary.
 */
export interface SettlementAdapter {
  /** Current state of one in-flight settlement. */
  status(reference: SettlementReference): Promise<SettlementState>;
  /** Submit the destination-side completion. Must be idempotent. */
  complete(reference: SettlementReference): Promise<SettlementState>;
  /** Transport reachability and progress, for the risk engine. */
  health(): Promise<SettlementHealth>;
}
