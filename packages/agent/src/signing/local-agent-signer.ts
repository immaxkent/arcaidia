/**
 * The local agent authority.
 *
 * Signs `FillAuthorization` typed data with a private key held in this process.
 * Used by the deterministic local lifecycle and by the tests; WP-09 substitutes
 * a Circle Agent Wallet behind the same `AgentAuthority` interface without any
 * caller changing.
 *
 * The typed data comes from the shared domain package rather than being rebuilt
 * here, so the signer, the vault's Solidity verifier and the tests all hash the
 * same structure. A signer that constructed its own typed data would be one
 * schema drift away from producing signatures the vault silently rejects.
 */

import { privateKeyToAccount } from 'viem/accounts';
import {
  fillAuthorizationTypedData,
  type Address,
  type AgentAuthority,
  type FillAuthorization,
  type Hex,
  type SignedFillAuthorization,
} from '@arcaidia/domain';

export interface FillAuthorizationDomainInput {
  readonly chainId: number;
  readonly verifyingContract: Address;
}

export class LocalAgentSigner implements AgentAuthority {
  readonly address: Address;

  private readonly account: ReturnType<typeof privateKeyToAccount>;

  constructor(privateKey: Hex) {
    this.account = privateKeyToAccount(privateKey);
    this.address = this.account.address;
  }

  async signFillAuthorization(
    authorization: FillAuthorization,
    domain: FillAuthorizationDomainInput,
  ): Promise<SignedFillAuthorization> {
    const signature = await this.account.signTypedData(
      fillAuthorizationTypedData(authorization, domain),
    );

    return { authorization, signature, signer: this.address };
  }
}
