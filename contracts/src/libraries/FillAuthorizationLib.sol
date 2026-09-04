// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {FillAuthorization} from "./ArcaidiaTypes.sol";

/// @title FillAuthorizationLib
/// @notice EIP-712 hashing for fill authorizations.
///
/// @dev Must produce byte-identical digests to `packages/domain/src/eip712.ts`.
///      `test/FillAuthorization.t.sol` locks that against a fixture shared with
///      the TypeScript suite.
///
///      The domain separator binds **both** `chainId` and `verifyingContract`,
///      and both are load-bearing here in a way they are not in most protocols:
///      Arcaidia deliberately deploys identical vault bytecode to identical
///      CREATE2 addresses on both chains. Without `chainId`, one signature would
///      authorise a fill on Ethereum *and* on Arc — the same authorization spent
///      twice, against two different pools of LP capital.
library FillAuthorizationLib {
    bytes32 internal constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    bytes32 internal constant DOMAIN_NAME_HASH = keccak256("Arcaidia");
    bytes32 internal constant DOMAIN_VERSION_HASH = keccak256("1");

    /// @dev Field order and types must match `FILL_AUTHORIZATION_TYPES` exactly.
    bytes32 internal constant FILL_AUTHORIZATION_TYPEHASH = keccak256(
        "FillAuthorization(bytes32 intentId,uint256 sourceChainId,bytes32 sourceTxHash,address recipient,uint256 inputAmount,uint256 outputAmount,uint256 feeAmount,uint64 expiry,uint256 nonce)"
    );

    function domainSeparator(uint256 chainId, address verifyingContract) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH, DOMAIN_NAME_HASH, DOMAIN_VERSION_HASH, chainId, verifyingContract
            )
        );
    }

    function structHash(FillAuthorization memory authorization) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                FILL_AUTHORIZATION_TYPEHASH,
                authorization.intentId,
                authorization.sourceChainId,
                authorization.sourceTxHash,
                authorization.recipient,
                authorization.inputAmount,
                authorization.outputAmount,
                authorization.feeAmount,
                authorization.expiry,
                authorization.nonce
            )
        );
    }

    /// @notice The digest a signer signs and the vault recovers from.
    function digest(FillAuthorization memory authorization, uint256 chainId, address verifyingContract)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encodePacked(
                "\x19\x01", domainSeparator(chainId, verifyingContract), structHash(authorization)
            )
        );
    }
}
