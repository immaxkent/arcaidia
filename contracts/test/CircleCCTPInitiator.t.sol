// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ChainFixture} from "./base/ChainFixture.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {MockTokenMessengerV2} from "../src/mocks/MockTokenMessengerV2.sol";
import {CircleCCTPInitiator} from "../src/CircleCCTPInitiator.sol";

/// @notice Tests for the real canonical settlement transport (WP-10).
/// @dev Exercises `CircleCCTPInitiator` against `MockTokenMessengerV2` in both
///      directions, the same way `MockSettlementInitiator.t.sol` exercises the
///      test double it replaces: the router-facing contract (`ISettlementInitiator`)
///      is what must behave correctly, whichever transport sits behind it.
contract CircleCCTPInitiatorTest is ChainFixture {
    MockUSDC internal asset;
    MockTokenMessengerV2 internal tokenMessenger;
    CircleCCTPInitiator internal initiator;

    address internal owner = makeAddr("owner");
    address internal router = makeAddr("router");
    address internal destinationReceiver = makeAddr("destinationReceiver");
    bytes32 internal constant INTENT_ID = keccak256("intent");

    uint32 internal constant SEPOLIA_DOMAIN = 0;
    uint32 internal constant ARC_DOMAIN = 26;

    function setUp() public {
        _configureDirection();
        asset = new MockUSDC();
        tokenMessenger = new MockTokenMessengerV2();

        vm.prank(owner);
        initiator = new CircleCCTPInitiator(owner, address(tokenMessenger), address(asset));

        asset.mint(router, 10_000e6);
        vm.prank(router);
        asset.approve(address(initiator), type(uint256).max);
    }

    function _domainOf(uint256 chainId) internal pure returns (uint32) {
        return chainId == ETHEREUM_SEPOLIA ? SEPOLIA_DOMAIN : ARC_DOMAIN;
    }

    function _configureDestination() internal {
        vm.prank(owner);
        initiator.setDomain(destinationChainId, _domainOf(destinationChainId));
    }

    // -----------------------------------------------------------------------
    // Configuration / access control
    // -----------------------------------------------------------------------

    function test_constructorRejectsZeroAddresses() public {
        vm.expectRevert(CircleCCTPInitiator.ZeroAddress.selector);
        new CircleCCTPInitiator(address(0), address(tokenMessenger), address(asset));

        vm.expectRevert(CircleCCTPInitiator.ZeroAddress.selector);
        new CircleCCTPInitiator(owner, address(0), address(asset));

        vm.expectRevert(CircleCCTPInitiator.ZeroAddress.selector);
        new CircleCCTPInitiator(owner, address(tokenMessenger), address(0));
    }

    function test_defaultsToStandardFinalizedZeroFee() public view {
        assertEq(initiator.minFinalityThreshold(), 2000);
        assertEq(initiator.maxFee(), 0);
    }

    function test_destinationUnsupportedUntilConfigured() public view {
        assertFalse(initiator.supportsDestination(destinationChainId));
    }

    function test_onlyOwnerCanConfigureDomain() public {
        vm.expectRevert(CircleCCTPInitiator.NotOwner.selector);
        initiator.setDomain(destinationChainId, ARC_DOMAIN);
    }

    function test_onlyOwnerCanConfigureFinality() public {
        vm.expectRevert(CircleCCTPInitiator.NotOwner.selector);
        initiator.setFinality(1000, 5e6);
    }

    function test_onlyOwnerCanTransferOwnership() public {
        vm.expectRevert(CircleCCTPInitiator.NotOwner.selector);
        initiator.transferOwnership(router);
    }

    function test_ethereumDomainZeroIsDistinguishableFromUnconfigured() public {
        // Ethereum's real CCTP domain is 0 — the same value an unconfigured
        // mapping entry reads as. `domainConfigured` must be what callers trust,
        // not `domainFor` alone, or Ethereum would look permanently unsupported.
        vm.prank(owner);
        initiator.setDomain(ETHEREUM_SEPOLIA, 0);

        assertTrue(initiator.supportsDestination(ETHEREUM_SEPOLIA));
        assertEq(initiator.domainFor(ETHEREUM_SEPOLIA), 0);
    }

    // -----------------------------------------------------------------------
    // Happy path
    // -----------------------------------------------------------------------

    function test_initiateBurnsThroughTokenMessenger() public {
        _configureDestination();

        vm.prank(router);
        initiator.initiateSettlement(address(asset), 1_000e6, destinationChainId, destinationReceiver, INTENT_ID);

        assertEq(tokenMessenger.callCount(), 1);
        (
            uint256 amount,
            uint32 domain,
            bytes32 mintRecipient,
            address burnToken,
            bytes32 destinationCaller,
            uint256 maxFee,
            uint32 minFinalityThreshold
        ) = tokenMessenger.calls(0);

        assertEq(amount, 1_000e6);
        assertEq(domain, _domainOf(destinationChainId));
        assertEq(mintRecipient, bytes32(uint256(uint160(destinationReceiver))));
        assertEq(burnToken, address(asset));
        assertEq(destinationCaller, bytes32(0));
        assertEq(maxFee, 0);
        assertEq(minFinalityThreshold, 2000);
    }

    function test_initiatePullsFundsFromCallerAndForwardsToTokenMessenger() public {
        _configureDestination();

        vm.prank(router);
        initiator.initiateSettlement(address(asset), 1_000e6, destinationChainId, destinationReceiver, INTENT_ID);

        assertEq(asset.balanceOf(router), 9_000e6);
        assertEq(asset.balanceOf(address(initiator)), 0, "initiator must not retain the burnt asset");
        assertEq(asset.balanceOf(address(tokenMessenger)), 1_000e6);
    }

    function test_initiateResetsApprovalAfterBurn() public {
        _configureDestination();

        vm.prank(router);
        initiator.initiateSettlement(address(asset), 1_000e6, destinationChainId, destinationReceiver, INTENT_ID);

        assertEq(asset.allowance(address(initiator), address(tokenMessenger)), 0);
    }

    function test_initiateReturnsANonZeroReference() public {
        _configureDestination();

        vm.prank(router);
        bytes32 ref = initiator.initiateSettlement(
            address(asset), 1_000e6, destinationChainId, destinationReceiver, INTENT_ID
        );
        assertTrue(ref != bytes32(0));
    }

    function test_referencesAreUniquePerCommitment() public {
        _configureDestination();
        asset.mint(router, 10_000e6);

        vm.startPrank(router);
        bytes32 first = initiator.initiateSettlement(
            address(asset), 1_000e6, destinationChainId, destinationReceiver, INTENT_ID
        );
        bytes32 second = initiator.initiateSettlement(
            address(asset), 1_000e6, destinationChainId, destinationReceiver, INTENT_ID
        );
        vm.stopPrank();

        assertTrue(first != second);
    }

    function test_configuredFinalityIsUsedOnSubsequentBurns() public {
        _configureDestination();

        vm.prank(owner);
        initiator.setFinality(1000, 5e6);

        vm.prank(router);
        initiator.initiateSettlement(address(asset), 1_000e6, destinationChainId, destinationReceiver, INTENT_ID);

        (,,,,, uint256 maxFee, uint32 minFinalityThreshold) = tokenMessenger.calls(0);
        assertEq(maxFee, 5e6);
        assertEq(minFinalityThreshold, 1000);
    }

    // -----------------------------------------------------------------------
    // Sad paths
    // -----------------------------------------------------------------------

    function test_initiateRevertsForUnconfiguredDestination() public {
        vm.prank(router);
        vm.expectRevert(
            abi.encodeWithSelector(CircleCCTPInitiator.UnsupportedDestination.selector, destinationChainId)
        );
        initiator.initiateSettlement(address(asset), 1_000e6, destinationChainId, destinationReceiver, INTENT_ID);
    }

    function test_initiateRevertsForWrongAsset() public {
        _configureDestination();
        MockUSDC wrongAsset = new MockUSDC();
        wrongAsset.mint(router, 1_000e6);
        vm.prank(router);
        wrongAsset.approve(address(initiator), type(uint256).max);

        vm.prank(router);
        vm.expectRevert(
            abi.encodeWithSelector(CircleCCTPInitiator.AssetMismatch.selector, address(asset), address(wrongAsset))
        );
        initiator.initiateSettlement(address(wrongAsset), 1_000e6, destinationChainId, destinationReceiver, INTENT_ID);
    }

    /// The router must be able to revert the whole transaction — including its
    /// own intent-recording state — if canonical commitment fails. Nothing may
    /// be pulled from the caller when the underlying burn reverts.
    function test_initiateRevertsAtomicallyWhenTokenMessengerFails() public {
        _configureDestination();
        tokenMessenger.setShouldRevert(true);

        vm.prank(router);
        vm.expectRevert(MockTokenMessengerV2.MockDepositForBurnFailed.selector);
        initiator.initiateSettlement(address(asset), 1_000e6, destinationChainId, destinationReceiver, INTENT_ID);

        assertEq(asset.balanceOf(router), 10_000e6, "no funds should move on failure");
    }

    function test_initiateRevertsWithoutSufficientAllowance() public {
        _configureDestination();
        vm.prank(router);
        asset.approve(address(initiator), 0);

        vm.prank(router);
        vm.expectRevert();
        initiator.initiateSettlement(address(asset), 1_000e6, destinationChainId, destinationReceiver, INTENT_ID);
    }
}
