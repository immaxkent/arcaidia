// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ArcaidiaLiquidityVault} from "../../src/ArcaidiaLiquidityVault.sol";

/// @notice Test-only vault exposing the fill accounting without the
///         authorization machinery that arrives in WP-05.
/// @dev The accounting effect of a fast fill — assets leave, exposure rises —
///      is what makes ERC-4626 pricing interesting, and it must be testable
///      before the EIP-712 path exists. This calls the same internal function
///      the real `fastFill` will call, so the accounting under test is the
///      accounting that ships. Never deployed outside tests.
contract VaultHarness is ArcaidiaLiquidityVault {
    function advanceForTest(bytes32 intentId, address recipient, uint256 outputAmount) external {
        _recordFastFill(intentId, recipient, outputAmount);
    }
}
