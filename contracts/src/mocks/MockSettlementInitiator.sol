// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISettlementInitiator} from "../interfaces/ISettlementInitiator.sol";

/// @title MockSettlementInitiator
/// @notice Test double for canonical settlement initiation.
/// @dev Models the parts of CCTP that matter to the router: it pulls the funds,
///      returns an opaque reference, and can be made to fail. The failure mode
///      is not decoration — the router must revert the entire transaction if
///      commitment fails, so that an intent can never exist without its
///      canonical commitment.
contract MockSettlementInitiator is ISettlementInitiator {
    using SafeERC20 for IERC20;

    /// @notice Set false to simulate an unavailable settlement transport.
    bool public shouldSucceed = true;

    /// @notice Destinations this initiator will accept. Defaults to accepting all.
    mapping(uint256 => bool) public unsupportedDestination;

    /// @notice Total committed, so tests can assert funds actually moved.
    uint256 public totalCommitted;

    uint256 private _refNonce;

    event SettlementInitiated(
        bytes32 indexed intentId, bytes32 settlementRef, uint256 amount, uint256 destinationChainId
    );

    error SettlementInitiationFailed();

    function setShouldSucceed(bool value) external {
        shouldSucceed = value;
    }

    function setUnsupportedDestination(uint256 chainId, bool value) external {
        unsupportedDestination[chainId] = value;
    }

    function supportsDestination(uint256 destinationChainId) external view returns (bool) {
        return !unsupportedDestination[destinationChainId];
    }

    function initiateSettlement(
        address asset,
        uint256 amount,
        uint256 destinationChainId,
        address destinationReceiver,
        bytes32 intentId
    ) external returns (bytes32 settlementRef) {
        if (!shouldSucceed) revert SettlementInitiationFailed();

        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        totalCommitted += amount;

        settlementRef = keccak256(abi.encode(intentId, destinationChainId, destinationReceiver, _refNonce++));
        emit SettlementInitiated(intentId, settlementRef, amount, destinationChainId);
    }
}
