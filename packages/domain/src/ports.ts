/**
 * Adapter boundaries (specification §17).
 *
 * Each port has a local implementation used by the deterministic lifecycle, and
 * a sponsor implementation substituted later. Substituting one must not change
 * any caller; if it would, the port is wrong and the port gets fixed.
 *
 * ---------------------------------------------------------------------------
 * PROVISIONAL — `AgentAuthority` is not frozen.
 *
 * Q4 has been answered (Circle Agent Wallets can sign EIP-712 typed data and
 * return a raw signature), and the recommendation is the `sign` shape. It is
 * still marked provisional until WP-05 begins, because one detail is unverified:
 * whether the agent wallet is provisioned as an EOA — whose signature the vault
 * can `ecrecover` — or as a smart contract account, which would require EIP-1271
 * verification and a different vault check.
 *
 * Both shapes are represented below so that answer can land without a rewrite.
 * Do not delete the `execute` variant before that is confirmed onchain.
 * ---------------------------------------------------------------------------
 */

import type { Address, Bytes32, TxHash } from './types/primitives.js';
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
 * `kind` discriminates the two supported models:
 *  - `'sign'`    — produces an EIP-712 signature; a relayer submits the fill.
 *                  The vault authenticates the recovered signer.
 *  - `'execute'` — the authority submits the destination transaction itself.
 *                  The vault authenticates `msg.sender`.
 */
export type AgentAuthority = SigningAuthority | ExecutingAuthority;

export interface SigningAuthority {
  readonly kind: 'sign';
  /** The address the vault must allowlist. */
  readonly address: Address;
  signFillAuthorization(
    authorization: FillAuthorization,
    domain: { chainId: number; verifyingContract: Address },
  ): Promise<SignedFillAuthorization>;
}

export interface ExecutingAuthority {
  readonly kind: 'execute';
  readonly address: Address;
  /** Submits the fill directly; returns the destination transaction hash. */
  executeFastFill(authorization: FillAuthorization, vault: Address, chainId: number): Promise<TxHash>;
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
