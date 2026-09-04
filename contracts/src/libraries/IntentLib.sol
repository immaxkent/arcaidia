// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Intent} from "./ArcaidiaTypes.sol";

/// @title IntentLib
/// @notice Canonical intent identity.
/// @dev `intentId` is the replay key on both chains and the correlation key
///      across the indexer, the agent and the settlement worker. It MUST produce
///      byte-identical output to `computeIntentId` in
///      `packages/domain/src/intent-id.ts`. `test/IntentId.t.sol` asserts that
///      against a fixture shared with the TypeScript suite; if the two ever
///      diverge, every already-indexed intent silently re-keys, so that test is
///      load-bearing rather than decorative.
library IntentLib {
    /// @dev Domain-separating tag mixed into the preimage so an intent id can
    ///      never collide with an unrelated `abi.encode` of the same shape.
    ///      The string must match the TypeScript constant exactly.
    bytes32 internal constant INTENT_TYPEHASH = keccak256(
        "Intent(address sender,address recipient,address inputToken,uint256 amount,uint256 sourceChainId,uint256 destinationChainId,uint16 maxFeeBps,uint64 deadline,uint256 nonce)"
    );

    /// @notice Compute the canonical identifier for an intent.
    function computeIntentId(Intent memory intent) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                INTENT_TYPEHASH,
                intent.sender,
                intent.recipient,
                intent.inputToken,
                intent.amount,
                intent.sourceChainId,
                intent.destinationChainId,
                intent.maxFeeBps,
                intent.deadline,
                intent.nonce
            )
        );
    }
}
