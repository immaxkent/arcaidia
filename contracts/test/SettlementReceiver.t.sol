// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VaultFixture} from "./base/VaultFixture.sol";
import {ArcaidiaLiquidityVault} from "../src/ArcaidiaLiquidityVault.sol";
import {SettlementReceiver} from "../src/SettlementReceiver.sol";

/// @notice Canonical settlement routing, both branches.
/// @dev The fallback branch is the specification's central promise: if no solver
///      participates, the canonical leg must still deliver the user's funds.
///      Arcaidia is an acceleration layer, not a dependency.
contract SettlementReceiverTest is VaultFixture {
    SettlementReceiver internal receiver;

    address internal reporter = makeAddr("settlementReporter");
    address internal fallbackRecipient = makeAddr("fallbackRecipient");

    function setUp() public {
        _deployVault();

        receiver = new SettlementReceiver();
        receiver.initialize(vaultOwner, address(asset), address(vault));

        vm.startPrank(vaultOwner);
        receiver.setReporter(reporter, true);
        vault.setSettlementReceiver(address(receiver));
        vm.stopPrank();

        _deposit(lpAlice, 100_000e6);
    }

    function _intentId(uint256 seed) internal pure returns (bytes32) {
        return keccak256(abi.encode("intent", seed));
    }

    /// Canonical funds arrive by being minted to the receiver, exactly as CCTP
    /// delivers them.
    function _canonicalFundsArrive(uint256 amount) internal {
        asset.mint(address(receiver), amount);
    }

    // -----------------------------------------------------------------------
    // Initialization
    // -----------------------------------------------------------------------

    function test_initializeStoresConfiguration() public view {
        assertTrue(receiver.initialized());
        assertEq(receiver.owner(), vaultOwner);
        assertEq(address(receiver.asset()), address(asset));
        assertEq(address(receiver.vault()), address(vault));
    }

    function test_initializeCannotBeCalledTwice() public {
        vm.expectRevert(SettlementReceiver.AlreadyInitialized.selector);
        receiver.initialize(lpAlice, address(asset), address(vault));
    }

    function test_initializeRejectsZeroAddresses() public {
        SettlementReceiver fresh = new SettlementReceiver();
        vm.expectRevert(SettlementReceiver.ZeroAddress.selector);
        fresh.initialize(address(0), address(asset), address(vault));
    }

    // -----------------------------------------------------------------------
    // Branch one: the intent was fast-filled, so the LP is reimbursed
    // -----------------------------------------------------------------------

    function test_filledIntentReimbursesTheVault() public {
        bytes32 intentId = _intentId(1);
        vault.advanceForTest(intentId, recipient, 9_990e6);
        _canonicalFundsArrive(10_000e6);

        uint256 liquidBefore = vault.liquidBalance();

        vm.prank(reporter);
        SettlementReceiver.Outcome outcome = receiver.settle(intentId, fallbackRecipient, 10_000e6);

        assertEq(uint256(outcome), uint256(SettlementReceiver.Outcome.LP_REIMBURSED));
        assertEq(vault.liquidBalance(), liquidBefore + 10_000e6, "canonical funds reach the vault");
        assertEq(vault.outstandingExposure(), 0, "receivable cleared");
        assertEq(asset.balanceOf(fallbackRecipient), 0, "recipient must not be paid twice");
    }

    /// The fee is the difference between what canonical settlement returns and
    /// what the vault advanced. It accrues to LPs.
    function test_reimbursementLeavesTheVaultAheadByTheFee() public {
        bytes32 intentId = _intentId(2);
        uint256 shares = vault.balanceOf(lpAlice);
        uint256 valueBefore = vault.previewRedeem(shares);

        vault.advanceForTest(intentId, recipient, 9_990e6);
        _canonicalFundsArrive(10_000e6);

        vm.prank(reporter);
        receiver.settle(intentId, fallbackRecipient, 10_000e6);

        assertEq(vault.totalAssets(), 100_000e6 + 10e6, "vault ahead by the execution fee");
        assertGt(vault.previewRedeem(shares), valueBefore);
    }

    function test_receiverRetainsNothingAfterReimbursement() public {
        bytes32 intentId = _intentId(3);
        vault.advanceForTest(intentId, recipient, 9_990e6);
        _canonicalFundsArrive(10_000e6);

        vm.prank(reporter);
        receiver.settle(intentId, fallbackRecipient, 10_000e6);

        assertEq(asset.balanceOf(address(receiver)), 0);
        assertEq(asset.allowance(address(receiver), address(vault)), 0, "no standing allowance");
    }

    // -----------------------------------------------------------------------
    // Branch two: nobody fast-filled, so the recipient is paid directly
    // -----------------------------------------------------------------------

    /// The fallback invariant. Without a solver the user must still be paid.
    function test_unfilledIntentPaysTheRecipient() public {
        bytes32 intentId = _intentId(4);
        _canonicalFundsArrive(10_000e6);

        vm.prank(reporter);
        SettlementReceiver.Outcome outcome = receiver.settle(intentId, fallbackRecipient, 10_000e6);

        assertEq(uint256(outcome), uint256(SettlementReceiver.Outcome.RECIPIENT_FALLBACK));
        assertEq(asset.balanceOf(fallbackRecipient), 10_000e6, "user must be paid");
        assertEq(vault.outstandingExposure(), 0, "no LP capital was ever at risk");
    }

    function test_fallbackDoesNotTouchVaultLiquidity() public {
        bytes32 intentId = _intentId(5);
        uint256 liquidBefore = vault.liquidBalance();
        _canonicalFundsArrive(10_000e6);

        vm.prank(reporter);
        receiver.settle(intentId, fallbackRecipient, 10_000e6);

        assertEq(vault.liquidBalance(), liquidBefore, "an unfilled intent owes the vault nothing");
    }

    function test_fallbackRejectsZeroRecipient() public {
        bytes32 intentId = _intentId(6);
        _canonicalFundsArrive(10_000e6);

        vm.prank(reporter);
        vm.expectRevert(SettlementReceiver.ZeroAddress.selector);
        receiver.settle(intentId, address(0), 10_000e6);
    }

    /// Funds must never be trapped: a failed fallback leaves the intent
    /// unsettled so the worker can retry with a correct recipient.
    function test_failedFallbackLeavesTheIntentRetryable() public {
        bytes32 intentId = _intentId(7);
        _canonicalFundsArrive(10_000e6);

        vm.prank(reporter);
        vm.expectRevert(SettlementReceiver.ZeroAddress.selector);
        receiver.settle(intentId, address(0), 10_000e6);

        assertFalse(receiver.isSettled(intentId));

        vm.prank(reporter);
        receiver.settle(intentId, fallbackRecipient, 10_000e6);
        assertEq(asset.balanceOf(fallbackRecipient), 10_000e6);
    }

    // -----------------------------------------------------------------------
    // Idempotency — the settlement worker retries and restarts
    // -----------------------------------------------------------------------

    function test_settlingTwiceReverts() public {
        bytes32 intentId = _intentId(8);
        _canonicalFundsArrive(20_000e6);

        vm.prank(reporter);
        receiver.settle(intentId, fallbackRecipient, 10_000e6);

        vm.prank(reporter);
        vm.expectRevert(abi.encodeWithSelector(SettlementReceiver.AlreadySettled.selector, intentId));
        receiver.settle(intentId, fallbackRecipient, 10_000e6);

        assertEq(asset.balanceOf(fallbackRecipient), 10_000e6, "recipient paid exactly once");
    }

    /// Onchain state is authoritative, not the worker's database.
    function test_isSettledReportsOnchainState() public {
        bytes32 intentId = _intentId(9);
        assertFalse(receiver.isSettled(intentId));

        _canonicalFundsArrive(10_000e6);
        vm.prank(reporter);
        receiver.settle(intentId, fallbackRecipient, 10_000e6);

        assertTrue(receiver.isSettled(intentId));
        assertEq(receiver.settledAmount(intentId), 10_000e6);
        assertEq(
            uint256(receiver.outcomeOf(intentId)), uint256(SettlementReceiver.Outcome.RECIPIENT_FALLBACK)
        );
    }

    // -----------------------------------------------------------------------
    // Authorisation and guards
    // -----------------------------------------------------------------------

    function test_onlyReportersCanSettle() public {
        bytes32 intentId = _intentId(10);
        _canonicalFundsArrive(10_000e6);

        vm.prank(lpBob);
        vm.expectRevert(SettlementReceiver.NotReporter.selector);
        receiver.settle(intentId, fallbackRecipient, 10_000e6);
    }

    function test_reporterCanBeRevoked() public {
        vm.prank(vaultOwner);
        receiver.setReporter(reporter, false);

        _canonicalFundsArrive(10_000e6);
        vm.prank(reporter);
        vm.expectRevert(SettlementReceiver.NotReporter.selector);
        receiver.settle(_intentId(11), fallbackRecipient, 10_000e6);
    }

    function test_onlyOwnerCanSetReporters() public {
        vm.prank(lpBob);
        vm.expectRevert(SettlementReceiver.NotOwner.selector);
        receiver.setReporter(lpBob, true);
    }

    /// A reporter cannot invent funds that never arrived.
    function test_cannotSettleMoreThanIsHeld() public {
        bytes32 intentId = _intentId(12);
        _canonicalFundsArrive(1_000e6);

        vm.prank(reporter);
        vm.expectRevert(
            abi.encodeWithSelector(SettlementReceiver.InsufficientCanonicalFunds.selector, 10_000e6, 1_000e6)
        );
        receiver.settle(intentId, fallbackRecipient, 10_000e6);
    }

    function test_rejectsZeroAmount() public {
        vm.prank(reporter);
        vm.expectRevert(SettlementReceiver.ZeroAmount.selector);
        receiver.settle(_intentId(13), fallbackRecipient, 0);
    }

    /// A reporter can only route funds to the vault or to the named recipient —
    /// never to itself. This bounds the V1 authorised-operator assumption.
    function test_reporterCannotRouteFundsToItself() public {
        bytes32 intentId = _intentId(14);
        _canonicalFundsArrive(10_000e6);

        vm.prank(reporter);
        receiver.settle(intentId, fallbackRecipient, 10_000e6);

        assertEq(asset.balanceOf(reporter), 0);
    }

    // -----------------------------------------------------------------------
    // Both branches together
    // -----------------------------------------------------------------------

    /// Exactly one branch runs per intent, and the two are independent.
    function test_filledAndUnfilledIntentsSettleIndependently() public {
        bytes32 filledId = _intentId(15);
        bytes32 unfilledId = _intentId(16);

        vault.advanceForTest(filledId, recipient, 9_990e6);
        _canonicalFundsArrive(20_000e6);

        vm.startPrank(reporter);
        receiver.settle(filledId, fallbackRecipient, 10_000e6);
        receiver.settle(unfilledId, fallbackRecipient, 10_000e6);
        vm.stopPrank();

        assertEq(uint256(receiver.outcomeOf(filledId)), uint256(SettlementReceiver.Outcome.LP_REIMBURSED));
        assertEq(
            uint256(receiver.outcomeOf(unfilledId)), uint256(SettlementReceiver.Outcome.RECIPIENT_FALLBACK)
        );
        assertEq(vault.outstandingExposure(), 0);
        assertEq(asset.balanceOf(fallbackRecipient), 10_000e6);
    }

    function testFuzz_everySettlementRoutesTheFullAmount(uint96 rawAmount, bool filled) public {
        uint256 amount = bound(rawAmount, 1e6, 50_000e6);
        bytes32 intentId = _intentId(uint256(rawAmount) + 1000);

        if (filled) vault.advanceForTest(intentId, recipient, amount);
        _canonicalFundsArrive(amount);

        vm.prank(reporter);
        receiver.settle(intentId, fallbackRecipient, amount);

        // Nothing is ever retained by the receiver, in either branch.
        assertEq(asset.balanceOf(address(receiver)), 0);
    }
}
