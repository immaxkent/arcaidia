// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ChainFixture} from "./base/ChainFixture.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {MockSettlementInitiator} from "../src/mocks/MockSettlementInitiator.sol";

/// @notice Tests for the settlement-initiation test double.
/// @dev The double itself is load-bearing: the router's most important
///      behaviour is reverting when commitment fails, and that behaviour can
///      only be tested if this mock can fail convincingly.
contract MockSettlementInitiatorTest is ChainFixture {
    MockUSDC internal asset;
    MockSettlementInitiator internal initiator;

    address internal router = makeAddr("router");
    address internal receiver = makeAddr("settlementReceiver");
    bytes32 internal constant INTENT_ID = keccak256("intent");

    function setUp() public {
        _configureDirection();
        asset = new MockUSDC();
        initiator = new MockSettlementInitiator();

        asset.mint(router, 10_000e6);
        vm.prank(router);
        asset.approve(address(initiator), type(uint256).max);
    }

    function test_supportsAllDestinationsByDefault() public view {
        assertTrue(initiator.supportsDestination(destinationChainId));
        assertTrue(initiator.supportsDestination(sourceChainId));
    }

    function test_destinationCanBeMarkedUnsupported() public {
        initiator.setUnsupportedDestination(destinationChainId, true);
        assertFalse(initiator.supportsDestination(destinationChainId));
    }

    function test_initiatePullsFundsFromCaller() public {
        vm.prank(router);
        initiator.initiateSettlement(address(asset), 1_000e6, destinationChainId, receiver, INTENT_ID);

        assertEq(asset.balanceOf(router), 9_000e6);
        assertEq(asset.balanceOf(address(initiator)), 1_000e6);
        assertEq(initiator.totalCommitted(), 1_000e6);
    }

    function test_initiateReturnsANonZeroReference() public {
        vm.prank(router);
        bytes32 ref =
            initiator.initiateSettlement(address(asset), 1_000e6, destinationChainId, receiver, INTENT_ID);
        assertTrue(ref != bytes32(0));
    }

    /// Two commitments for the same intent must not collide, or the settlement
    /// agent could correlate canonical funds to the wrong message.
    function test_referencesAreUniquePerCommitment() public {
        vm.startPrank(router);
        bytes32 first =
            initiator.initiateSettlement(address(asset), 100e6, destinationChainId, receiver, INTENT_ID);
        bytes32 second =
            initiator.initiateSettlement(address(asset), 100e6, destinationChainId, receiver, INTENT_ID);
        vm.stopPrank();

        assertTrue(first != second);
    }

    function test_initiateRevertsWhenTransportFails() public {
        initiator.setShouldSucceed(false);

        vm.prank(router);
        vm.expectRevert(MockSettlementInitiator.SettlementInitiationFailed.selector);
        initiator.initiateSettlement(address(asset), 1_000e6, destinationChainId, receiver, INTENT_ID);
    }

    /// A failed commitment must move no funds at all. If it took the money and
    /// reverted only the bookkeeping, the router's revert guarantee would be
    /// worthless.
    function test_failedInitiationMovesNoFunds() public {
        initiator.setShouldSucceed(false);

        vm.prank(router);
        try initiator.initiateSettlement(address(asset), 1_000e6, destinationChainId, receiver, INTENT_ID) {
            revert("expected failure");
        } catch {}

        assertEq(asset.balanceOf(router), 10_000e6);
        assertEq(asset.balanceOf(address(initiator)), 0);
    }

    function test_initiateRevertsWithoutApproval() public {
        address stranger = makeAddr("stranger");
        asset.mint(stranger, 1_000e6);

        vm.prank(stranger);
        vm.expectRevert();
        initiator.initiateSettlement(address(asset), 1_000e6, destinationChainId, receiver, INTENT_ID);
    }
}
