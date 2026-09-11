// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IntentHookLib
/// @notice The canonical cross-chain metadata Arcaidia attaches to a CCTP V2 burn (DECISIONS.md D8).
/// @dev Carried verbatim in `BurnMessageV2.hookData` (offset 228 of the message body), so it is
///      covered by Circle's attestation. Deliberately tiny: `intentId` already commits to every
///      economic term (D5/D6); `recipient` is included so the no-fast-fill fallback branch can
///      pay out from attested bytes rather than a reporter's assertion. Must round-trip
///      byte-identically with `packages/domain/src/intent-hook.ts`.
library IntentHookLib {
    uint8 internal constant HOOK_VERSION = 1;

    /// @dev `abi.encode(uint8, bytes32, address)` — three 32-byte words.
    uint256 internal constant HOOK_LENGTH = 96;

    error MalformedIntentHook(uint256 length);
    error UnsupportedIntentHookVersion(uint8 version);

    function encode(bytes32 intentId, address recipient) internal pure returns (bytes memory) {
        return abi.encode(HOOK_VERSION, intentId, recipient);
    }

    function decode(bytes memory hookData) internal pure returns (bytes32 intentId, address recipient) {
        if (hookData.length != HOOK_LENGTH) revert MalformedIntentHook(hookData.length);
        uint8 version;
        (version, intentId, recipient) = abi.decode(hookData, (uint8, bytes32, address));
        if (version != HOOK_VERSION) revert UnsupportedIntentHookVersion(version);
    }
}
