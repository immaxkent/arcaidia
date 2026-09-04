// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

/// @title ChainFixture
/// @notice Supplies the direction under test from configuration.
/// @dev Every scenario must pass in both directions. Rather than duplicating a
///      test file per direction — the same duplication the specification forbids
///      in the contracts themselves — suites inherit this and read
///      `sourceChainId` / `destinationChainId`.
///
///      `ARCAIDIA_SOURCE=ethereum` (the default) runs Ethereum → Arc.
///      `ARCAIDIA_SOURCE=arc` runs Arc → Ethereum.
///
///      `pnpm test:sc-eth` and `pnpm test:sc-arc` are exactly those two runs.
abstract contract ChainFixture is Test {
    uint256 internal constant ETHEREUM_SEPOLIA = 11155111;
    uint256 internal constant ARC_TESTNET = 5042002;

    uint256 internal sourceChainId;
    uint256 internal destinationChainId;
    string internal directionLabel;

    function _configureDirection() internal {
        string memory source = vm.envOr("ARCAIDIA_SOURCE", string("ethereum"));

        if (keccak256(bytes(source)) == keccak256(bytes("arc"))) {
            sourceChainId = ARC_TESTNET;
            destinationChainId = ETHEREUM_SEPOLIA;
            directionLabel = "arc -> ethereum";
        } else {
            sourceChainId = ETHEREUM_SEPOLIA;
            destinationChainId = ARC_TESTNET;
            directionLabel = "ethereum -> arc";
        }
    }

    /// @dev Asserts the fixture is configured; guards against a suite that
    ///      forgot to call `_configureDirection` in `setUp`.
    function _assertDirectionConfigured() internal view {
        assertTrue(sourceChainId != 0, "source chain not configured");
        assertTrue(destinationChainId != 0, "destination chain not configured");
        assertTrue(sourceChainId != destinationChainId, "source and destination must differ");
    }
}
