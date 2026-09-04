// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {RouterFixture} from "./base/RouterFixture.sol";
import {ArcaidiaIntentRouter} from "../src/ArcaidiaIntentRouter.sol";
import {MockSettlementInitiator} from "../src/mocks/MockSettlementInitiator.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

contract ArcaidiaIntentRouterTest is RouterFixture {
    bytes32 internal constant IntentCreatedTopic = keccak256(
        "IntentCreated(bytes32,address,address,address,uint256,uint256,uint256,uint16,uint64,uint256,bytes32)"
    );

    function setUp() public {
        _deployRouter();
    }

    // -----------------------------------------------------------------------
    // Initialization
    // -----------------------------------------------------------------------

    function test_initializeStoresConfiguration() public view {
        assertTrue(router.initialized());
        assertEq(router.owner(), deployerOwner);
        assertEq(address(router.settlementAsset()), address(asset));
        assertEq(address(router.settlementInitiator()), address(initiator));
        assertEq(router.maxIntentAmount(), MAX_INTENT);
        assertEq(router.maxInFlightValue(), MAX_IN_FLIGHT);
    }

    /// The constructor takes no arguments so init code is identical on every
    /// chain; initialize therefore has to be single-shot or a later caller
    /// could seize the router.
    function test_initializeCannotBeCalledTwice() public {
        vm.expectRevert(ArcaidiaIntentRouter.AlreadyInitialized.selector);
        router.initialize(alice, address(asset), address(initiator), 1, 1);
    }

    function test_initializeRejectsZeroAddresses() public {
        ArcaidiaIntentRouter fresh = new ArcaidiaIntentRouter();
        vm.expectRevert(ArcaidiaIntentRouter.ZeroAddress.selector);
        fresh.initialize(address(0), address(asset), address(initiator), 1, 1);

        vm.expectRevert(ArcaidiaIntentRouter.ZeroAddress.selector);
        fresh.initialize(deployerOwner, address(0), address(initiator), 1, 1);

        vm.expectRevert(ArcaidiaIntentRouter.ZeroAddress.selector);
        fresh.initialize(deployerOwner, address(asset), address(0), 1, 1);
    }

    // -----------------------------------------------------------------------
    // Happy path
    // -----------------------------------------------------------------------

    function test_createIntentPullsFundsAndCommitsThem() public {
        uint256 aliceBefore = asset.balanceOf(alice);

        _createDefaultIntent(1_000e6, 1);

        assertEq(asset.balanceOf(alice), aliceBefore - 1_000e6, "user funds not pulled");
        assertEq(initiator.totalCommitted(), 1_000e6, "funds not committed to settlement");
        // The router must not retain the principal: it is committed onward.
        assertEq(asset.balanceOf(address(router)), 0, "router retained principal");
    }

    function test_createIntentReturnsTheCanonicalId() public {
        uint64 deadline = _defaultDeadline();
        bytes32 expected = router.quoteIntentId(alice, bob, 1_000e6, destinationChainId, 30, deadline, 1);

        vm.prank(alice);
        bytes32 actual = router.createIntent(bob, 1_000e6, destinationChainId, 30, deadline, 1);

        assertEq(actual, expected);
        assertTrue(router.intentExists(actual));
    }

    function test_createIntentEmitsIntentCreated() public {
        uint64 deadline = _defaultDeadline();
        bytes32 intentId = router.quoteIntentId(alice, bob, 1_000e6, destinationChainId, 30, deadline, 1);

        vm.recordLogs();
        vm.prank(alice);
        router.createIntent(bob, 1_000e6, destinationChainId, 30, deadline, 1);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == IntentCreatedTopic && logs[i].topics[1] == intentId) {
                found = true;
                (,,,,,,, bytes32 settlementRef) = abi.decode(
                    logs[i].data, (address, uint256, uint256, uint256, uint16, uint64, uint256, bytes32)
                );
                assertTrue(settlementRef != bytes32(0), "settlement reference must be recorded");
            }
        }
        assertTrue(found, "IntentCreated not emitted");
    }

    function test_createIntentRecordsInFlightValue() public {
        _createDefaultIntent(1_000e6, 1);
        assertEq(router.totalInFlight(), 1_000e6);
        _createDefaultIntent(2_000e6, 2);
        assertEq(router.totalInFlight(), 3_000e6);
    }

    function test_createIntentMarksTheNonceUsed() public {
        _createDefaultIntent(1_000e6, 7);
        assertTrue(router.nonceUsed(alice, 7));
        assertFalse(router.nonceUsed(alice, 8));
        assertFalse(router.nonceUsed(bob, 7));
    }

    /// The same terms in the opposite direction are a different intent, and the
    /// id must reflect that. This is the direction-as-data property at the
    /// contract boundary.
    function test_intentIdDependsOnTheDirection() public view {
        bytes32 forward = router.quoteIntentId(alice, bob, 1_000e6, destinationChainId, 30, 1_800_000_000, 1);
        bytes32 reverse = router.quoteIntentId(alice, bob, 1_000e6, sourceChainId, 30, 1_800_000_000, 1);
        assertTrue(forward != reverse);
    }

    // -----------------------------------------------------------------------
    // The central guarantee: no intent without a canonical commitment
    // -----------------------------------------------------------------------

    /// If settlement initiation fails, nothing at all may persist. A solver
    /// seeing an IntentCreated event must be able to trust that the source
    /// funds are already committed.
    function test_failedSettlementRevertsTheWholeTransaction() public {
        initiator.setShouldSucceed(false);
        uint256 aliceBefore = asset.balanceOf(alice);
        uint64 deadline = _defaultDeadline();
        bytes32 intentId = router.quoteIntentId(alice, bob, 1_000e6, destinationChainId, 30, deadline, 1);

        vm.prank(alice);
        vm.expectRevert(MockSettlementInitiator.SettlementInitiationFailed.selector);
        router.createIntent(bob, 1_000e6, destinationChainId, 30, deadline, 1);

        assertEq(asset.balanceOf(alice), aliceBefore, "user funds must be untouched");
        assertFalse(router.intentExists(intentId), "no intent may survive a failed commitment");
        assertFalse(router.nonceUsed(alice, 1), "nonce must not be consumed");
        assertEq(router.totalInFlight(), 0, "in-flight value must not increase");
    }

    /// The transport is asked before any funds move, so the user is never left
    /// with funds taken and no commitment.
    function test_unsupportedTransportRevertsBeforePullingFunds() public {
        initiator.setUnsupportedDestination(destinationChainId, true);
        uint256 aliceBefore = asset.balanceOf(alice);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                ArcaidiaIntentRouter.SettlementTransportUnavailable.selector, destinationChainId
            )
        );
        router.createIntent(bob, 1_000e6, destinationChainId, 30, _defaultDeadline(), 1);

        assertEq(asset.balanceOf(alice), aliceBefore);
    }

    function test_routerLeavesNoStandingAllowance() public {
        _createDefaultIntent(1_000e6, 1);
        assertEq(asset.allowance(address(router), address(initiator)), 0);
    }

    // -----------------------------------------------------------------------
    // Rejections
    // -----------------------------------------------------------------------

    function test_rejectsUnconfiguredDestination() public {
        uint256 unknownChain = 424242;
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(ArcaidiaIntentRouter.DestinationNotAllowed.selector, unknownChain)
        );
        router.createIntent(bob, 1_000e6, unknownChain, 30, _defaultDeadline(), 1);
    }

    function test_rejectsZeroRecipient() public {
        vm.prank(alice);
        vm.expectRevert(ArcaidiaIntentRouter.ZeroAddress.selector);
        router.createIntent(address(0), 1_000e6, destinationChainId, 30, _defaultDeadline(), 1);
    }

    function test_rejectsZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(ArcaidiaIntentRouter.ZeroAmount.selector);
        router.createIntent(bob, 0, destinationChainId, 30, _defaultDeadline(), 1);
    }

    function test_rejectsAmountAboveIntentCap() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                ArcaidiaIntentRouter.IntentAmountAboveCap.selector, MAX_INTENT + 1, MAX_INTENT
            )
        );
        router.createIntent(bob, MAX_INTENT + 1, destinationChainId, 30, _defaultDeadline(), 1);
    }

    function test_rejectsExpiredDeadline() public {
        uint64 past = uint64(block.timestamp);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ArcaidiaIntentRouter.DeadlineInPast.selector, past));
        router.createIntent(bob, 1_000e6, destinationChainId, 30, past, 1);
    }

    function test_rejectsReusedNonce() public {
        _createDefaultIntent(1_000e6, 1);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ArcaidiaIntentRouter.NonceAlreadyUsed.selector, alice, 1));
        router.createIntent(bob, 2_000e6, destinationChainId, 30, _defaultDeadline(), 1);
    }

    function test_rejectsFeeCeilingAboveDenominator() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(ArcaidiaIntentRouter.FeeCeilingAboveDenominator.selector, uint16(10_001))
        );
        router.createIntent(bob, 1_000e6, destinationChainId, 10_001, _defaultDeadline(), 1);
    }

    function test_rejectsWhenInFlightCapWouldBeExceeded() public {
        vm.prank(deployerOwner);
        router.setLimits(MAX_INTENT, 1_500e6);

        _createDefaultIntent(1_000e6, 1);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(ArcaidiaIntentRouter.InFlightCapExceeded.selector, 2_000e6, 1_500e6)
        );
        router.createIntent(bob, 1_000e6, destinationChainId, 30, _defaultDeadline(), 2);
    }

    function test_rejectsWhenPaused() public {
        vm.prank(deployerOwner);
        router.setPaused(true);

        vm.prank(alice);
        vm.expectRevert(ArcaidiaIntentRouter.RouterPaused.selector);
        router.createIntent(bob, 1_000e6, destinationChainId, 30, _defaultDeadline(), 1);
    }

    function test_rejectsIntentWithoutApproval() public {
        address stranger = makeAddr("stranger");
        asset.mint(stranger, 10_000e6);

        vm.prank(stranger);
        vm.expectRevert();
        router.createIntent(bob, 1_000e6, destinationChainId, 30, _defaultDeadline(), 1);
    }

    // -----------------------------------------------------------------------
    // Ownership and configuration
    // -----------------------------------------------------------------------

    function test_onlyOwnerCanConfigureDestinations() public {
        vm.prank(alice);
        vm.expectRevert(ArcaidiaIntentRouter.NotOwner.selector);
        router.setDestination(999, bob);
    }

    function test_onlyOwnerCanSetLimits() public {
        vm.prank(alice);
        vm.expectRevert(ArcaidiaIntentRouter.NotOwner.selector);
        router.setLimits(1, 1);
    }

    function test_onlyOwnerCanPause() public {
        vm.prank(alice);
        vm.expectRevert(ArcaidiaIntentRouter.NotOwner.selector);
        router.setPaused(true);
    }

    /// A router must never route to the chain it is deployed on.
    function test_destinationCannotBeTheSourceChain() public {
        vm.prank(deployerOwner);
        vm.expectRevert(ArcaidiaIntentRouter.DestinationIsSourceChain.selector);
        router.setDestination(block.chainid, bob);
    }

    function test_ownershipCanBeTransferred() public {
        vm.prank(deployerOwner);
        router.transferOwnership(alice);
        assertEq(router.owner(), alice);

        vm.prank(alice);
        router.setPaused(true);
        assertTrue(router.paused());
    }

    // -----------------------------------------------------------------------
    // In-flight release
    // -----------------------------------------------------------------------

    function test_releaseInFlightReducesExposure() public {
        bytes32 intentId = _createDefaultIntent(1_000e6, 1);
        assertEq(router.totalInFlight(), 1_000e6);

        vm.prank(deployerOwner);
        router.releaseInFlight(intentId, 1_000e6);
        assertEq(router.totalInFlight(), 0);
    }

    function test_releaseInFlightRejectsUnknownIntent() public {
        bytes32 unknown = keccak256("nope");
        vm.prank(deployerOwner);
        vm.expectRevert(abi.encodeWithSelector(ArcaidiaIntentRouter.UnknownIntent.selector, unknown));
        router.releaseInFlight(unknown, 1);
    }

    function test_releaseInFlightCannotUnderflow() public {
        bytes32 intentId = _createDefaultIntent(1_000e6, 1);
        vm.prank(deployerOwner);
        vm.expectRevert(ArcaidiaIntentRouter.NothingInFlight.selector);
        router.releaseInFlight(intentId, 1_001e6);
    }

    function test_onlyOwnerCanReleaseInFlight() public {
        bytes32 intentId = _createDefaultIntent(1_000e6, 1);
        vm.prank(alice);
        vm.expectRevert(ArcaidiaIntentRouter.NotOwner.selector);
        router.releaseInFlight(intentId, 1_000e6);
    }

    // -----------------------------------------------------------------------
    // Fuzz
    // -----------------------------------------------------------------------

    function testFuzz_anyAcceptedIntentCommitsExactlyItsAmount(uint96 amount, uint96 nonce) public {
        amount = uint96(bound(amount, 1, MAX_INTENT));

        uint256 aliceBefore = asset.balanceOf(alice);
        _createDefaultIntent(amount, nonce);

        assertEq(asset.balanceOf(alice), aliceBefore - amount);
        assertEq(initiator.totalCommitted(), amount);
        assertEq(router.totalInFlight(), amount);
    }
}
