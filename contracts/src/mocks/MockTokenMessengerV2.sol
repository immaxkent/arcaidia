// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ITokenMessengerV2} from "../interfaces/ITokenMessengerV2.sol";

/// @title MockTokenMessengerV2
/// @notice Test double for Circle's real `TokenMessengerV2`.
/// @dev Records every call so `CircleCCTPInitiator.t.sol` can assert exactly
///      what was burned and how, and can be told to revert so the initiator's
///      "commitment must fail atomically" behaviour is testable — the same
///      reasoning `MockSettlementInitiator` documents for the router.
///
///      Actually pulls and holds the token via `transferFrom`, mirroring the
///      real contract's custody of the burnt amount, so a test asserting the
///      initiator's own balance afterwards sees what it would against the real
///      TokenMessenger.
contract MockTokenMessengerV2 is ITokenMessengerV2 {
    struct Call {
        uint256 amount;
        uint32 destinationDomain;
        bytes32 mintRecipient;
        address burnToken;
        bytes32 destinationCaller;
        uint256 maxFee;
        uint32 minFinalityThreshold;
    }

    Call[] public calls;
    bool public shouldRevert;

    error MockDepositForBurnFailed();

    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function callCount() external view returns (uint256) {
        return calls.length;
    }

    function depositForBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold
    ) external {
        if (shouldRevert) revert MockDepositForBurnFailed();

        calls.push(
            Call({
                amount: amount,
                destinationDomain: destinationDomain,
                mintRecipient: mintRecipient,
                burnToken: burnToken,
                destinationCaller: destinationCaller,
                maxFee: maxFee,
                minFinalityThreshold: minFinalityThreshold
            })
        );

        IERC20(burnToken).transferFrom(msg.sender, address(this), amount);
    }
}
