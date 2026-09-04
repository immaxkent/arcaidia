// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ArcaidiaLiquidityVault} from "../../src/ArcaidiaLiquidityVault.sol";

/// @notice Test-only vault exposing the exposure transitions that the fill path
///         will drive once it exists.
/// @dev The accounting effect of a fast fill — assets leave, `outstandingExposure`
///      rises — is what makes ERC-4626 pricing interesting, and it must be
///      testable before the authorization machinery is built. This harness is
///      never deployed outside tests.
contract VaultHarness is ArcaidiaLiquidityVault {
    using SafeERC20 for IERC20;

    /// @notice Simulate a fast fill: pay a recipient and record the receivable.
    function advanceForTest(address recipient, uint256 amount) external {
        outstandingExposure += amount;
        asset.safeTransfer(recipient, amount);
    }

    /// @notice Simulate canonical reimbursement: assets return, receivable clears.
    function reimburseForTest(uint256 amount) external {
        asset.safeTransferFrom(msg.sender, address(this), amount);
        outstandingExposure -= amount;
    }
}
