// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Intent} from "./ArcaidiaTypes.sol";

/// @title IntentLib
/// @notice Canonical intent identity — schema v1.1.
/// @dev `intentId` is the replay key on both chains and the correlation key
///      across the indexer, the agent, the vault (which recomputes it from the
///      intent it is handed — D6), the CCTP hook (D8) and the settlement worker.
///      It MUST produce byte-identical output to `computeIntentId` in
///      `packages/domain/src/intent-id.ts`. `test/IntentId.t.sol` asserts that
///      against fixtures shared with the TypeScript suite; if the two ever
///      diverge, every already-indexed intent silently re-keys, so that test is
///      load-bearing rather than decorative.
library IntentLib {
    /// @dev Domain-separating tag mixed into the preimage so an intent id can
    ///      never collide with an unrelated `abi.encode` of the same shape.
    ///      The string must match the TypeScript constant exactly.
    bytes32 internal constant INTENT_TYPEHASH = keccak256(
        "Intent(uint8 intentVersion,address sender,address recipient,address inputToken,uint256 amount,uint256 sourceChainId,uint256 destinationChainId,uint16 maxFeeBps,uint64 deadline,uint256 nonce,address tokenOut,uint256 targetMinOut)"
    );

    /// @notice Compute the canonical identifier for an intent.
    /// @dev Two `abi.encode` calls concatenated rather than one thirteen-argument
    ///      call, to stay clear of stack depth under `via_ir = false`. Every field
    ///      is a static type, so the concatenation is byte-identical to a single
    ///      `abi.encode` of all of them — which is exactly what the TypeScript
    ///      side computes, and what the shared vectors prove.
    function computeIntentId(Intent memory intent) internal pure returns (bytes32) {
        return keccak256(
            bytes.concat(
                abi.encode(
                    INTENT_TYPEHASH,
                    intent.intentVersion,
                    intent.sender,
                    intent.recipient,
                    intent.inputToken,
                    intent.amount,
                    intent.sourceChainId
                ),
                abi.encode(
                    intent.destinationChainId,
                    intent.maxFeeBps,
                    intent.deadline,
                    intent.nonce,
                    intent.tokenOut,
                    intent.targetMinOut
                )
            )
        );
    }
}
