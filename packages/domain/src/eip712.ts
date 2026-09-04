/**
 * EIP-712 schema for `FillAuthorization` (specification §8).
 *
 * One definition, consumed by the signer, the vault's Solidity verifier and the
 * tests. The domain binds `chainId` and `verifyingContract` to the *destination*
 * chain's vault: Arcaidia deploys the same contracts to both chains, at
 * deliberately identical CREATE2 addresses, so without both bindings an
 * authorization minted for one chain's vault would be replayable against the
 * other. That is the sharpest edge in a symmetric deployment and the domain
 * separator is what closes it.
 */

import { hashTypedData } from 'viem';
import type { Address, Bytes32 } from './types/primitives.js';
import type { FillAuthorization } from './types/fill.js';

export const EIP712_DOMAIN_NAME = 'Arcaidia' as const;
export const EIP712_DOMAIN_VERSION = '1' as const;

/**
 * Typed-data field definitions. `sourceChainId` and `sourceTxHash` are part of
 * the signed payload — they bind the authorization to the specific verified
 * source commitment, so a valid signature cannot be pointed at a different one.
 */
export const FILL_AUTHORIZATION_TYPES = {
  FillAuthorization: [
    { name: 'intentId', type: 'bytes32' },
    { name: 'sourceChainId', type: 'uint256' },
    { name: 'sourceTxHash', type: 'bytes32' },
    { name: 'recipient', type: 'address' },
    { name: 'inputAmount', type: 'uint256' },
    { name: 'outputAmount', type: 'uint256' },
    { name: 'feeAmount', type: 'uint256' },
    { name: 'expiry', type: 'uint64' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const;

/** Identifies the vault that may accept an authorization. */
export interface FillAuthorizationDomain {
  /** The destination chain's id. */
  readonly chainId: number;
  /** The destination `ArcaidiaLiquidityVault`. */
  readonly verifyingContract: Address;
}

export function buildEip712Domain(domain: FillAuthorizationDomain) {
  return {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_DOMAIN_VERSION,
    chainId: domain.chainId,
    verifyingContract: domain.verifyingContract,
  } as const;
}

/** The full typed-data payload, ready to hand to any EIP-712 signer. */
export function fillAuthorizationTypedData(
  authorization: FillAuthorization,
  domain: FillAuthorizationDomain,
) {
  return {
    domain: buildEip712Domain(domain),
    types: FILL_AUTHORIZATION_TYPES,
    primaryType: 'FillAuthorization' as const,
    message: {
      intentId: authorization.intentId,
      sourceChainId: BigInt(authorization.sourceChainId),
      sourceTxHash: authorization.sourceTxHash,
      recipient: authorization.recipient,
      inputAmount: authorization.inputAmount,
      outputAmount: authorization.outputAmount,
      feeAmount: authorization.feeAmount,
      expiry: BigInt(authorization.expiry),
      nonce: authorization.nonce,
    },
  };
}

/** The EIP-712 digest the vault will recover a signer from. */
export function hashFillAuthorization(
  authorization: FillAuthorization,
  domain: FillAuthorizationDomain,
): Bytes32 {
  return hashTypedData(fillAuthorizationTypedData(authorization, domain));
}
