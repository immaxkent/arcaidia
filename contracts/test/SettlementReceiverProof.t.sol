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
    /// Circle's TokenMessengerV2 on both testnets — the `recipient` every real burn message carries.
    address internal constant TOKEN_MESSENGER = 0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA;

    /// A real Arc→Sepolia burn message for intent 0x81c0…a7f8 (2026-09-12, the first live v2 batch),
    /// exactly as Circle's Iris API returned it. The field layout this contract relies on is asserted
    /// against these bytes, not against our own mock's idea of a message.
    bytes internal constant REAL_MESSAGE = hex"000000010000001a000000000feed6f1f30d3b92b43f298573b4bd2c0f2bf9f6182dc80f3c44a0403e550f200000000000000000000000008fe6b999dc680ccfdd5bf7eb0974218be2542daa0000000000000000000000008fe6b999dc680ccfdd5bf7eb0974218be2542daa0000000000000000000000008b93b54d6df61e9422d14c309f3c9ab950b920cd000007d0000007d00000000100000000000000000000000036000000000000000000000000000000000000000000000000000000000000008b93b54d6df61e9422d14c309f3c9ab950b920cd000000000000000000000000000000000000000000000000000000000022f1500000000000000000000000006095944456c20a0acf7c44e4ff40dea8f041d9b3000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000181c0c72a3f09514483e408d04fde4d071402e36309a01bb4d869ee03a8d0a7f8000000000000000000000000d2a11b3d4a71cad528e13e868401f2534881937c";

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
            // As on a real network: the header names Circle's TokenMessenger as the handler,
            // and *this* contract only through destinationCaller and the body's mintRecipient.
            recipient: TOKEN_MESSENGER,
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

    // -----------------------------------------------------------------------
    // Golden vector — the real message that exposed the v2.0 receiver's wrong check
    // -----------------------------------------------------------------------

    function test_realMessageParsesToTheFieldsCircleActuallySends() public view {
        CctpMessageLib.Parsed memory parsed = this.parseExternal(REAL_MESSAGE);
        assertEq(parsed.recipient, TOKEN_MESSENGER, "header recipient is the TokenMessenger, never the receiver");
        assertEq(parsed.destinationCaller, 0x8B93b54d6Df61E9422D14C309F3c9Ab950b920Cd, "destinationCaller is the receiver");
        assertEq(parsed.mintRecipient, 0x8B93b54d6Df61E9422D14C309F3c9Ab950b920Cd, "mintRecipient is the receiver");
        assertEq(parsed.amount, 0x22f150, "amount");
        (bytes32 intentId, address recipient) = IntentHookLib.decode(parsed.hookData);
        assertEq(intentId, 0x81c0c72a3f09514483e408d04fde4d071402e36309a01bb4d869ee03a8d0a7f8, "intent id in the hook");
        assertEq(recipient, 0xd2A11B3d4A71Cad528E13e868401F2534881937C, "recipient in the hook");
    }

    /// The v2.0 receiver required `header.recipient == address(this)` and so refused every real
    /// message with MessageNotForThisReceiver. A message shaped exactly like Circle's must be accepted.
    function test_acceptsAMessageWhoseHeaderRecipientIsTheTokenMessenger() public {
        bytes32 intentId = keccak256("golden");
        address recipient = address(0xCAFE);
        bytes memory message = _message(intentId, recipient, 5e6, 0, keccak256("golden-nonce"));
        bytes memory attestation = transmitter.attest(message);
        SettlementReceiver.Outcome outcome = receiver.settleWithProof(message, attestation);
        assertEq(uint8(outcome), uint8(SettlementReceiver.Outcome.RECIPIENT_FALLBACK));
        assertEq(asset.balanceOf(recipient), 5e6);
    }

    /// A message with no destinationCaller restriction (anyone may present it) is still ours if it
    /// mints here; one minted elsewhere is refused whatever the caller field says.
    function test_destinationCallerZeroIsAcceptedWhenTheMintIsHere() public {
        MockMessageTransmitterV2.MessageSpec memory spec = _spec(keccak256("open"), address(0xCAFE), 5e6, 0, keccak256("open-nonce"));
        spec.destinationCaller = address(0);
        bytes memory message = transmitter.encodeMessage(spec);
        bytes memory attestation = transmitter.attest(message);
        receiver.settleWithProof(message, attestation);
        assertEq(asset.balanceOf(address(0xCAFE)), 5e6);
    }

    function test_destinationCallerNamingAnotherContractIsRefused() public {
        MockMessageTransmitterV2.MessageSpec memory spec = _spec(keccak256("other"), address(0xCAFE), 5e6, 0, keccak256("other-nonce"));
        spec.destinationCaller = address(0xD00D);
        bytes memory message = transmitter.encodeMessage(spec);
        bytes memory attestation = transmitter.attest(message);
        vm.expectRevert(abi.encodeWithSelector(SettlementReceiver.MessageNotForThisReceiver.selector, address(0xD00D), address(receiver)));
        receiver.settleWithProof(message, attestation);
    }

    function parseExternal(bytes calldata message) external pure returns (CctpMessageLib.Parsed memory) {
        return CctpMessageLib.parse(message);
    }
}
