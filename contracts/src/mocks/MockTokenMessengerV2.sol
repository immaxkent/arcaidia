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
///      TokenMessenger. `hookDataOf[i]` records the hook the i-th call carried
///      (empty for a plain `depositForBurn`), and `withHook[i]` which entry
///      point was used — the real contract rejects an empty hook on the hook
///      entry point, and this mock does too.
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
    mapping(uint256 => bytes) public hookDataOf;
    mapping(uint256 => bool) public withHook;
    bool public shouldRevert;

    error MockDepositForBurnFailed();
    error HookDataIsEmpty();

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
        _record(amount, destinationDomain, mintRecipient, burnToken, destinationCaller, maxFee, minFinalityThreshold, "", false);
    }

    function depositForBurnWithHook(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold,
        bytes calldata hookData
    ) external {
        // Mirrors the real contract's `require(hookData.length > 0, "Hook data is empty")`.
        if (hookData.length == 0) revert HookDataIsEmpty();
        _record(amount, destinationDomain, mintRecipient, burnToken, destinationCaller, maxFee, minFinalityThreshold, hookData, true);
    }

    function _record(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold,
        bytes memory hookData,
        bool usedHook
    ) private {
        if (shouldRevert) revert MockDepositForBurnFailed();

        uint256 index = calls.length;
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
        hookDataOf[index] = hookData;
        withHook[index] = usedHook;

        IERC20(burnToken).transferFrom(msg.sender, address(this), amount);
    }
}
