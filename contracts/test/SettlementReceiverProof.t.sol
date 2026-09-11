// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VaultFixture} from "./base/VaultFixture.sol";
import {SettlementReceiver} from "../src/SettlementReceiver.sol";
import {IntentHookLib} from "../src/libraries/IntentHookLib.sol";
import {CctpMessageLib} from "../src/libraries/CctpMessageLib.sol";
import {MockMessageTransmitterV2} from "../src/mocks/MockMessageTransmitterV2.sol";
import {IFillRegistry} from "../src/interfaces/IFillRegistry.sol";

/// @notice A "vault" that won a claim but cannot be reimbursed — models the pathological winner
///         `HELD_FOR_VAULT` exists for. Toggle `fixed` to let `retryHeld` succeed.
contract RevertingWinner is IFillRegistry {
    bool public fixedNow;
    function setFixed(bool v) external { fixedNow = v; }
    function isFilled(bytes32) external pure returns (bool) { return true; }
    function advancedPrincipal(bytes32) external pure returns (uint256) { return 1; }
    function recordReimbursement(bytes32, uint256) external view {
        if (!fixedNow) revert("winner refuses");
    }
}

/// @notice WP-26 / D8: canonical settlement routed from Circle-attested bytes.
contract SettlementReceiverProofTest is VaultFixture {
    SettlementReceiver internal receiver;
    MockMessageTransmitterV2 internal transmitter;

    address internal fallbackRecipient = makeAddr("fallbackRecipient");
    uint32 internal constant SRC_DOMAIN = 0;
    uint32 internal constant DST_DOMAIN = 26;

    function setUp() public {
        _deployVault();
        transmitter = new MockMessageTransmitterV2(asset);
        receiver = new SettlementReceiver();
        receiver.initialize(vaultOwner, address(asset), address(market), address(transmitter));
        vm.prank(vaultOwner);
        vault.setSettlementReceiver(address(receiver));
        _deposit(lpAlice, 100_000e6);
    }

    function _spec(bytes32 intentId, address recipient, uint256 amount, uint256 fee, bytes32 nonce)
        internal
        view
        returns (MockMessageTransmitterV2.MessageSpec memory)
    {
        return MockMessageTransmitterV2.MessageSpec({
            sourceDomain: SRC_DOMAIN,
            destinationDomain: DST_DOMAIN,
            nonce: nonce,
            recipient: address(receiver),
            destinationCaller: address(receiver),
            burnToken: address(0xBEEF), // burnToken on the source chain
            mintRecipient: address(receiver),
            amount: amount,
            feeExecuted: fee,
            hookData: IntentHookLib.encode(intentId, recipient)
        });
    }

    function _message(bytes32 intentId, address recipient, uint256 amount, uint256 fee, bytes32 nonce)
        internal
        view
        returns (bytes memory)
    {
        return transmitter.encodeMessage(_spec(intentId, recipient, amount, fee, nonce));
    }

    function _settle(bytes memory message) internal returns (SettlementReceiver.Outcome) {
        return receiver.settleWithProof(message, transmitter.attest(message));
    }

    // -----------------------------------------------------------------------
    // Routing from the hook
    // -----------------------------------------------------------------------

    function test_filledIntentReimbursesTheWinnerFromAttestedBytes() public {
        bytes32 intentId = keccak256("filled");
        vault.advanceForTest(intentId, recipient, 9_990e6);
        uint256 vaultBefore = vault.liquidBalance();

        // Anyone may submit — a stranger does.
        vm.prank(makeAddr("stranger"));
        SettlementReceiver.Outcome outcome = _settle(_message(intentId, recipient, 10_000e6, 0, "n1"));

        assertEq(uint256(outcome), uint256(SettlementReceiver.Outcome.LP_REIMBURSED));
        assertEq(vault.liquidBalance(), vaultBefore + 10_000e6);
        assertEq(vault.outstandingExposure(), 0);
        assertEq(asset.balanceOf(address(receiver)), 0, "receiver retains nothing");
        assertTrue(receiver.isSettled(intentId));
        assertEq(receiver.settledAmount(intentId), 10_000e6);
    }

    function test_unfilledIntentPaysTheRecipientNamedInTheHook() public {
        bytes32 intentId = keccak256("unfilled");
        SettlementReceiver.Outcome outcome = _settle(_message(intentId, fallbackRecipient, 7_000e6, 0, "n2"));

        assertEq(uint256(outcome), uint256(SettlementReceiver.Outcome.RECIPIENT_FALLBACK));
        assertEq(asset.balanceOf(fallbackRecipient), 7_000e6);
        assertEq(vault.outstandingExposure(), 0, "vault untouched");
    }

    function test_feeExecutedIsHonoured() public {
        bytes32 intentId = keccak256("fee");
        _settle(_message(intentId, fallbackRecipient, 7_000e6, 3e6, "n3"));
        assertEq(asset.balanceOf(fallbackRecipient), 6_997e6, "routes exactly what was minted");
        assertEq(receiver.settledAmount(intentId), 6_997e6);
    }

    // -----------------------------------------------------------------------
    // Only genuine, intended messages
    // -----------------------------------------------------------------------

    function test_rejectsAMessageTheTransmitterDoesNotAccept() public {
        bytes memory message = _message(keccak256("x"), fallbackRecipient, 1_000e6, 0, "n4");
        vm.expectRevert(MockMessageTransmitterV2.InvalidAttestation.selector);
        receiver.settleWithProof(message, hex"deadbeef");
        assertFalse(receiver.isSettled(keccak256("x")));
    }

    function test_rejectsAMessageMintedElsewhere() public {
        MockMessageTransmitterV2.MessageSpec memory spec = _spec(keccak256("y"), fallbackRecipient, 1_000e6, 0, "n5");
        spec.mintRecipient = makeAddr("elsewhere");
        bytes memory message = transmitter.encodeMessage(spec);
        bytes memory attestation = transmitter.attest(message);
        vm.expectRevert(
            abi.encodeWithSelector(
                SettlementReceiver.MessageNotForThisReceiver.selector, address(receiver), makeAddr("elsewhere")
            )
        );
        receiver.settleWithProof(message, attestation);
    }

    function test_rejectsAMalformedHook() public {
        MockMessageTransmitterV2.MessageSpec memory spec = _spec(keccak256("z"), fallbackRecipient, 1_000e6, 0, "n6");
        spec.hookData = hex"c0ffee";
        bytes memory message = transmitter.encodeMessage(spec);
        bytes memory attestation = transmitter.attest(message);
        vm.expectRevert(abi.encodeWithSelector(IntentHookLib.MalformedIntentHook.selector, 3));
        receiver.settleWithProof(message, attestation);
    }

    function test_rejectsATooShortMessage() public {
        bytes memory message = new bytes(100);
        vm.expectRevert(abi.encodeWithSelector(CctpMessageLib.CctpMessageTooShort.selector, 100));
        receiver.settleWithProof(message, "");
    }

    /// A message for intent A cannot settle intent B: the hook is the only source of the id.
    function test_hookNamesTheIntentThatSettles() public {
        bytes32 a = keccak256("A");
        bytes32 b = keccak256("B");
        vault.advanceForTest(b, recipient, 5_000e6);

        _settle(_message(a, fallbackRecipient, 5_000e6, 0, "n7"));
        assertTrue(receiver.isSettled(a));
        assertFalse(receiver.isSettled(b), "B is untouched by A's message");
        assertEq(vault.outstandingExposure(), 5_000e6, "B's receivable still open");
    }

    function test_replayOfTheSameIntentIsRefused() public {
        bytes32 intentId = keccak256("replay");
        _settle(_message(intentId, fallbackRecipient, 1_000e6, 0, "n8"));
        bytes memory again = _message(intentId, fallbackRecipient, 1_000e6, 0, "n9");
        bytes memory attestation = transmitter.attest(again);
        vm.expectRevert(abi.encodeWithSelector(SettlementReceiver.AlreadySettled.selector, intentId));
        receiver.settleWithProof(again, attestation);
    }

    function test_theTransmitterRefusesAReusedNonce() public {
        bytes memory message = _message(keccak256("nonce-a"), fallbackRecipient, 1_000e6, 0, "same");
        _settle(message);
        bytes memory other = _message(keccak256("nonce-b"), fallbackRecipient, 1_000e6, 0, "same");
        bytes memory attestation = transmitter.attest(other);
        vm.expectRevert(abi.encodeWithSelector(MockMessageTransmitterV2.NonceAlreadyUsed.selector, bytes32("same")));
        receiver.settleWithProof(other, attestation);
    }

    /// Only the receiver may receive: a message naming it as `destinationCaller` cannot be
    /// front-run through the transmitter directly.
    function test_destinationCallerIsEnforcedByTheTransmitter() public {
        bytes memory message = _message(keccak256("fr"), fallbackRecipient, 1_000e6, 0, "n10");
        bytes memory attestation = transmitter.attest(message);
        address frontrunner = makeAddr("frontrunner");
        vm.expectRevert(
            abi.encodeWithSelector(MockMessageTransmitterV2.InvalidCaller.selector, address(receiver), frontrunner)
        );
        vm.prank(frontrunner);
        transmitter.receiveMessage(message, attestation);
    }

    // -----------------------------------------------------------------------
    // HELD_FOR_VAULT: canonical funds are never trapped
    // -----------------------------------------------------------------------

    function test_aWinnerThatCannotBeReimbursedParksTheFundsUntilRetry() public {
        RevertingWinner winner = new RevertingWinner();
        bytes32 intentId = keccak256("held");
        vm.prank(address(winner));
        market.claimIntent(intentId, 9_990e6, 10e6);

        SettlementReceiver.Outcome outcome = _settle(_message(intentId, recipient, 10_000e6, 0, "n11"));
        assertEq(uint256(outcome), uint256(SettlementReceiver.Outcome.HELD_FOR_VAULT));
        assertEq(receiver.heldFor(intentId), address(winner));
        assertEq(asset.balanceOf(address(receiver)), 10_000e6, "funds parked, not lost");
        assertTrue(receiver.isSettled(intentId), "a late fast fill is still blocked");

        vm.expectRevert("winner refuses");
        receiver.retryHeld(intentId);

        winner.setFixed(true);
        receiver.retryHeld(intentId);
        assertEq(uint256(receiver.outcomeOf(intentId)), uint256(SettlementReceiver.Outcome.LP_REIMBURSED));
        assertEq(receiver.heldFor(intentId), address(0));
    }

    function test_retryHeldRejectsIntentsThatAreNotHeld() public {
        vm.expectRevert(abi.encodeWithSelector(SettlementReceiver.NothingHeld.selector, keccak256("nope")));
        receiver.retryHeld(keccak256("nope"));
    }

    // -----------------------------------------------------------------------
    // The recovery path still works, still bounded
    // -----------------------------------------------------------------------

    function test_reporterPathStillRoutesButOnlyForReporters() public {
        address reporter = makeAddr("reporter");
        vm.prank(vaultOwner);
        receiver.setReporter(reporter, true);
        asset.mint(address(receiver), 500e6);

        vm.expectRevert(SettlementReceiver.NotReporter.selector);
        receiver.settle(keccak256("legacy"), fallbackRecipient, 500e6);

        vm.prank(reporter);
        receiver.settle(keccak256("legacy"), fallbackRecipient, 500e6);
        assertEq(asset.balanceOf(fallbackRecipient), 500e6);
    }
}
