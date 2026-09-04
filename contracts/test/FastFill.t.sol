// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {FastFillFixture} from "./base/FastFillFixture.sol";
import {ArcaidiaLiquidityVault} from "../src/ArcaidiaLiquidityVault.sol";
import {FillAuthorization} from "../src/libraries/ArcaidiaTypes.sol";

/// @notice The fill path: the only function that moves LP capital out of the vault.
/// @dev Every test here is a reason the vault refuses. The happy path is one
///      test; the rest are the policy.
contract FastFillTest is FastFillFixture {
    function setUp() public {
        _deployWithAgent();
    }

    // -----------------------------------------------------------------------
    // Happy path
    // -----------------------------------------------------------------------

    function test_validAuthorizationPaysTheRecipient() public {
        FillAuthorization memory auth = _authorization(1, 10_000e6, 50e6);

        address signer = _fill(auth);

        assertEq(signer, agent);
        assertEq(asset.balanceOf(recipient), 9_950e6, "recipient receives input minus fee");
        assertTrue(vault.isFilled(auth.intentId));
        assertEq(vault.advancedPrincipal(auth.intentId), 9_950e6);
        assertEq(vault.outstandingExposure(), 9_950e6);
    }

    /// Submission is permissionless: authority rests on the recovered signer, so
    /// any relayer may carry a valid authorization.
    function test_anyRelayerMaySubmitAValidAuthorization() public {
        FillAuthorization memory auth = _authorization(2, 10_000e6, 50e6);
        bytes memory signature = _sign(auth, agentKey);

        vm.prank(makeAddr("randomRelayer"));
        vault.fastFill(auth, signature);

        assertEq(asset.balanceOf(recipient), 9_950e6);
    }

    /// The fill leaves total assets flat: capital moved, nothing was earned yet.
    function test_fillDoesNotChangeTotalAssets() public {
        uint256 before = vault.totalAssets();
        _fill(_authorization(3, 10_000e6, 50e6));
        assertEq(vault.totalAssets(), before);
    }

    // -----------------------------------------------------------------------
    // Signature and signer
    // -----------------------------------------------------------------------

    function test_rejectsAnUnauthorisedSigner() public {
        FillAuthorization memory auth = _authorization(4, 10_000e6, 50e6);
        bytes memory signature = _sign(auth, rogueKey);

        vm.expectRevert(abi.encodeWithSelector(ArcaidiaLiquidityVault.SignerNotAuthorised.selector, rogue));
        vault.fastFill(auth, signature);
    }

    function test_rejectsARevokedSigner() public {
        vm.prank(vaultOwner);
        vault.setAuthorisedSigner(agent, false);

        FillAuthorization memory auth = _authorization(5, 10_000e6, 50e6);
        bytes memory signature = _sign(auth, agentKey);

        vm.expectRevert(abi.encodeWithSelector(ArcaidiaLiquidityVault.SignerNotAuthorised.selector, agent));
        vault.fastFill(auth, signature);
    }

    /// Tampering after signing changes the digest, so recovery yields some other
    /// address, which is not on the allowlist.
    function test_rejectsATamperedRecipient() public {
        FillAuthorization memory auth = _authorization(6, 10_000e6, 50e6);
        bytes memory signature = _sign(auth, agentKey);

        auth.recipient = makeAddr("attacker");
        vm.expectRevert();
        vault.fastFill(auth, signature);
        assertEq(asset.balanceOf(makeAddr("attacker")), 0);
    }

    function test_rejectsATamperedOutputAmount() public {
        FillAuthorization memory auth = _authorization(7, 10_000e6, 50e6);
        bytes memory signature = _sign(auth, agentKey);

        auth.outputAmount = 20_000e6;
        auth.inputAmount = auth.outputAmount + auth.feeAmount;
        vm.expectRevert();
        vault.fastFill(auth, signature);
    }

    function test_rejectsATamperedIntentId() public {
        FillAuthorization memory auth = _authorization(8, 10_000e6, 50e6);
        bytes memory signature = _sign(auth, agentKey);

        auth.intentId = keccak256("different intent");
        vm.expectRevert();
        vault.fastFill(auth, signature);
    }

    function test_rejectsAMalformedSignature() public {
        FillAuthorization memory auth = _authorization(9, 10_000e6, 50e6);
        vm.expectRevert();
        vault.fastFill(auth, hex"1234");
    }

    /// A signature for one chain's vault must not work on the other's, even
    /// though both vaults share an address by design.
    function test_rejectsASignatureForTheOtherChainsVault() public {
        FillAuthorization memory auth = _authorization(10, 10_000e6, 50e6);

        // Sign the digest as it would be on the source chain, then submit here.
        uint256 currentChain = block.chainid;
        vm.chainId(sourceChainId);
        bytes memory foreignSignature = _sign(auth, agentKey);
        vm.chainId(currentChain);

        vm.expectRevert();
        vault.fastFill(auth, foreignSignature);
    }

    // -----------------------------------------------------------------------
    // Replay
    // -----------------------------------------------------------------------

    function test_rejectsAReplayedIntent() public {
        FillAuthorization memory auth = _authorization(11, 10_000e6, 50e6);
        _fill(auth);

        FillAuthorization memory second = _authorization(12, 10_000e6, 50e6);
        second.intentId = auth.intentId;

        _fillExpectingRevert(
            second, abi.encodeWithSelector(ArcaidiaLiquidityVault.IntentAlreadyFilled.selector, auth.intentId)
        );
    }

    function test_rejectsAReusedAgentNonce() public {
        FillAuthorization memory auth = _authorization(13, 10_000e6, 50e6);
        _fill(auth);

        FillAuthorization memory second = _authorization(13, 5_000e6, 25e6);
        second.intentId = keccak256("another intent");

        _fillExpectingRevert(
            second, abi.encodeWithSelector(ArcaidiaLiquidityVault.AgentNonceAlreadyUsed.selector, 13)
        );
    }

    /// Submitting the identical signed authorization twice must pay once.
    function test_resubmittingTheSameAuthorizationPaysOnce() public {
        FillAuthorization memory auth = _authorization(14, 10_000e6, 50e6);
        bytes memory signature = _sign(auth, agentKey);

        vault.fastFill(auth, signature);
        vm.expectRevert();
        vault.fastFill(auth, signature);

        assertEq(asset.balanceOf(recipient), 9_950e6);
    }

    // -----------------------------------------------------------------------
    // Expiry
    // -----------------------------------------------------------------------

    function test_rejectsAnExpiredAuthorization() public {
        FillAuthorization memory auth = _authorization(15, 10_000e6, 50e6);
        vm.warp(auth.expiry + 1);

        _fillExpectingRevert(
            auth,
            abi.encodeWithSelector(
                ArcaidiaLiquidityVault.AuthorizationExpired.selector, auth.expiry, block.timestamp
            )
        );
    }

    /// Expiry is exclusive: an authorization is dead at its own timestamp.
    function test_rejectsAtExactlyTheExpiryTimestamp() public {
        FillAuthorization memory auth = _authorization(16, 10_000e6, 50e6);
        vm.warp(auth.expiry);

        _fillExpectingAnyRevert(auth);
    }

    function test_acceptsOneSecondBeforeExpiry() public {
        FillAuthorization memory auth = _authorization(17, 10_000e6, 50e6);
        vm.warp(auth.expiry - 1);
        _fill(auth);
        assertTrue(vault.isFilled(auth.intentId));
    }

    // -----------------------------------------------------------------------
    // Amounts, fees and caps
    // -----------------------------------------------------------------------

    /// Output plus fee must equal input, or the vault would be advancing against
    /// a principal that does not exist.
    function test_rejectsInconsistentAmounts() public {
        FillAuthorization memory auth = _authorization(18, 10_000e6, 50e6);
        auth.outputAmount = 9_000e6; // no longer input minus fee

        _fillExpectingRevert(
            auth,
            abi.encodeWithSelector(
                ArcaidiaLiquidityVault.AmountsInconsistent.selector, 10_000e6, 9_000e6, 50e6
            )
        );
    }

    function test_rejectsAFeeAboveTheProtocolCeiling() public {
        // 1% of 10,000 is 100; ask for 101.
        FillAuthorization memory auth = _authorization(19, 10_000e6, 101e6);

        _fillExpectingRevert(
            auth,
            abi.encodeWithSelector(ArcaidiaLiquidityVault.FeeAboveProtocolCeiling.selector, 101e6, 100e6)
        );
    }

    function test_acceptsAFeeExactlyAtTheCeiling() public {
        FillAuthorization memory auth = _authorization(20, 10_000e6, 100e6);
        _fill(auth);
        assertEq(asset.balanceOf(recipient), 9_900e6);
    }

    function test_rejectsAFillAboveTheSingleFillCap() public {
        FillAuthorization memory auth = _authorization(21, MAX_FILL + 2e6, 1e6);

        _fillExpectingRevert(
            auth,
            abi.encodeWithSelector(ArcaidiaLiquidityVault.FillAboveCap.selector, MAX_FILL + 1e6, MAX_FILL)
        );
    }

    function test_rejectsAFillBreachingTheExposureCap() public {
        _fill(_authorization(22, 25_000e6, 25e6)); // 24,975 exposed
        _fill(_authorization(23, 25_000e6, 25e6)); // 49,950 exposed

        FillAuthorization memory third = _authorization(24, 15_000e6, 15e6);
        _fillExpectingRevert(
            third,
            abi.encodeWithSelector(
                ArcaidiaLiquidityVault.ExposureCapExceeded.selector, 49_950e6 + 14_985e6, MAX_EXPOSURE
            )
        );
    }

    function test_rejectsAFillBreachingTheReserveFloor() public {
        vm.prank(vaultOwner);
        vault.setFillLimits(100_000e6, 200_000e6, MAX_FEE_BPS);

        // Available is 90,000; ask for more.
        FillAuthorization memory auth = _authorization(25, 95_000e6, 50e6);
        _fillExpectingRevert(
            auth,
            abi.encodeWithSelector(ArcaidiaLiquidityVault.InsufficientLiquidity.selector, 94_950e6, 90_000e6)
        );
    }

    // -----------------------------------------------------------------------
    // Pause and direction
    // -----------------------------------------------------------------------

    function test_rejectsWhenPaused() public {
        vm.prank(vaultOwner);
        vault.setPaused(true);

        _fillExpectingRevert(_authorization(26, 10_000e6, 50e6), ArcaidiaLiquidityVault.VaultPaused.selector);
    }

    /// A fill belongs on the chain the intent was not created on. An
    /// authorization naming this chain as its source is malformed.
    function test_rejectsAnAuthorizationWhoseSourceIsThisChain() public {
        FillAuthorization memory auth = _authorization(27, 10_000e6, 50e6);
        auth.sourceChainId = block.chainid;

        _fillExpectingRevert(
            auth, abi.encodeWithSelector(ArcaidiaLiquidityVault.WrongDestinationChain.selector, block.chainid)
        );
    }

    // -----------------------------------------------------------------------
    // No funds move on any rejection
    // -----------------------------------------------------------------------

    /// Whatever the reason for refusing, the vault must be exactly as it was.
    function test_noRejectionMovesFunds() public {
        uint256 liquidBefore = vault.liquidBalance();
        uint256 exposureBefore = vault.outstandingExposure();

        FillAuthorization memory expired = _authorization(28, 10_000e6, 50e6);
        vm.warp(expired.expiry + 1);
        _fillExpectingAnyRevert(expired);

        vm.warp(1);
        FillAuthorization memory overFee = _authorization(29, 10_000e6, 500e6);
        _fillExpectingAnyRevert(overFee);

        FillAuthorization memory unauthorised = _authorization(30, 10_000e6, 50e6);
        bytes memory rogueSignature = _sign(unauthorised, rogueKey);
        vm.expectRevert();
        vault.fastFill(unauthorised, rogueSignature);

        assertEq(vault.liquidBalance(), liquidBefore);
        assertEq(vault.outstandingExposure(), exposureBefore);
        assertEq(asset.balanceOf(recipient), 0);
    }

    // -----------------------------------------------------------------------
    // Fuzz
    // -----------------------------------------------------------------------

    /// No accepted fill may ever breach the reserve floor or the exposure cap.
    function testFuzz_acceptedFillsNeverBreachPolicy(uint96 rawInput, uint96 rawFee, uint64 nonce) public {
        uint256 input = bound(rawInput, 2, MAX_FILL);
        uint256 fee = bound(rawFee, 0, (input * MAX_FEE_BPS) / 10_000);

        FillAuthorization memory auth = _authorization(nonce, input, fee);

        try vault.fastFill(auth, _sign(auth, agentKey)) {
            assertLe(vault.outstandingExposure(), MAX_EXPOSURE);
            assertGe(vault.liquidBalance(), vault.reserveFloor());
        } catch {
            // A refusal is always acceptable; an unsafe acceptance is not.
        }
    }
}
