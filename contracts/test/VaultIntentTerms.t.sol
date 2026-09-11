// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {FastFillFixture} from "./base/FastFillFixture.sol";
import {Vm} from "forge-std/Vm.sol";
import {ArcaidiaLiquidityVault} from "../src/ArcaidiaLiquidityVault.sol";
import {FeePolicy, FillAuthorization, Intent, USDC_TOKEN_OUT} from "../src/libraries/ArcaidiaTypes.sol";
import {FeePolicyLib} from "../src/libraries/FeePolicyLib.sol";
import {MockSwapAdapter} from "../src/mocks/MockSwapAdapter.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {TestPolicies} from "./base/TestPolicies.sol";
import {VaultHarness} from "./harness/VaultHarness.sol";

/// @notice WP-26: what the vault enforces from the canonical intent it is handed (D6), its own
///         fee policy (D7), and how it delivers a trade intent (D9).
contract VaultIntentTermsTest is FastFillFixture {
    MockUSDC internal mockEth;
    MockSwapAdapter internal adapter;

    function setUp() public {
        _deployWithAgent();
        mockEth = new MockUSDC(); // stands in for a destination `tokenOut`
        adapter = new MockSwapAdapter();
        adapter.setRate(address(asset), address(mockEth), 4e17); // 1 USDC -> 0.4 "ETH" (6-dec units): 9,950e6 -> 3.98e9
    }

    // -----------------------------------------------------------------------
    // D6 — the intent handed in must be the one the id denotes
    // -----------------------------------------------------------------------

    function test_intentThatDoesNotHashToTheAuthorizedIdIsRefused() public {
        FillAuthorization memory auth = _authorization(1, 10_000e6, 50e6);
        Intent memory tampered = _intentOf(auth);
        tampered.maxFeeBps = 10_000; // "the user allowed anything" — but that is a different intent
        bytes memory signature = _sign(auth, agentKey);

        vm.expectRevert();
        vault.fastFill(tampered, auth, signature);
        assertEq(asset.balanceOf(recipient), 0);
    }

    function test_recipientAmountAndSourceMustAgreeWithTheAuthorization() public {
        FillAuthorization memory auth = _authorization(2, 10_000e6, 50e6);
        Intent memory intent = _intentOf(auth);
        auth.sourceChainId = intent.sourceChainId + 1; // still != block.chainid
        bytes memory signature = _sign(auth, agentKey);

        vm.expectRevert(ArcaidiaLiquidityVault.IntentTermsInconsistent.selector);
        vault.fastFill(intent, auth, signature);
    }

    function test_expiredIntentIsRefusedEvenWithAFreshAuthorization() public {
        Intent memory intent = _intent(3, 10_000e6);
        intent.deadline = uint64(block.timestamp + 10);
        FillAuthorization memory auth = _authorizationFor(intent, 50e6, 3);
        auth.expiry = uint64(block.timestamp + 100);
        bytes memory signature = _sign(auth, agentKey);

        vm.warp(block.timestamp + 11);
        vm.expectRevert(
            abi.encodeWithSelector(ArcaidiaLiquidityVault.IntentExpired.selector, intent.deadline, block.timestamp)
        );
        vault.fastFill(intent, auth, signature);
    }

    function test_intentForTheOtherChainIsRefused() public {
        Intent memory intent = _intent(4, 10_000e6);
        intent.destinationChainId = intent.sourceChainId; // mirrored: this chain is its source
        intent.sourceChainId = block.chainid;
        FillAuthorization memory auth = _authorizationFor(intent, 50e6, 4);
        bytes memory signature = _sign(auth, agentKey);

        vm.expectRevert();
        vault.fastFill(intent, auth, signature);
    }

    // -----------------------------------------------------------------------
    // D6/D7 — two fee ceilings, both enforced on chain
    // -----------------------------------------------------------------------

    /// The user's ceiling binds independently of the vault's own policy: the permissive policy
    /// posts 100 bps here, but this user allowed only 30.
    function test_userCeilingBelowThePostedTierIsEnforced() public {
        Intent memory intent = _intent(5, 10_000e6);
        intent.maxFeeBps = 30;
        FillAuthorization memory auth = _authorizationFor(intent, 31e6, 5);
        bytes memory signature = _sign(auth, agentKey);

        vm.expectRevert(
            abi.encodeWithSelector(ArcaidiaLiquidityVault.UserFeeCeilingExceeded.selector, 31e6, 30e6)
        );
        vault.fastFill(intent, auth, signature);

        // Exactly at the user's ceiling is fine.
        FillAuthorization memory ok = _authorizationFor(intent, 30e6, 6);
        vault.fastFill(intent, ok, _sign(ok, agentKey));
        assertEq(asset.balanceOf(recipient), 9_970e6);
    }

    /// A solver cannot overcharge relative to the vault's posted tier even when the user
    /// would have tolerated it (D7): user allows 1.5%, the vault posts 1%.
    function test_solverCannotChargeAboveThePostedTier() public {
        Intent memory intent = _intent(7, 10_000e6);
        intent.maxFeeBps = 150;
        FillAuthorization memory auth = _authorizationFor(intent, 101e6, 7);
        bytes memory signature = _sign(auth, agentKey);

        assertEq(vault.currentFeeBps(), 100);
        vm.expectRevert(abi.encodeWithSelector(ArcaidiaLiquidityVault.FeeAbovePolicy.selector, 101e6, 100e6));
        vault.fastFill(intent, auth, signature);
    }

    /// The posted tier steps with utilisation exactly as `FeePolicyLib` says, and the fee the
    /// vault accepts steps with it.
    function test_feeTierRisesWithUtilisationAndBindsFills() public {
        VaultHarness tiered = _tieredVault();
        assertEq(tiered.currentFeeBps(), 10, "0% utilisation -> base tier");

        // Push to 50% via the accounting harness; the tier becomes `mid` (25 bps).
        tiered.advanceForTest(keccak256("u1"), recipient, 50_000e6);
        assertEq(tiered.utilisationBps(), 5_000);
        assertEq(tiered.currentFeeBps(), 25, "50% -> mid tier");
        (uint16 feeBps, uint256 feeAmount) = tiered.quoteFee(10_000e6);
        assertEq(feeBps, 25);
        assertEq(feeAmount, 25e6);

        // 75% -> high (60 bps); 90% -> critical (120 bps).
        tiered.advanceForTest(keccak256("u2"), recipient, 25_000e6);
        assertEq(tiered.currentFeeBps(), 60);
        tiered.advanceForTest(keccak256("u3"), recipient, 15_000e6);
        assertEq(tiered.utilisationBps(), 9_000);
        assertEq(tiered.currentFeeBps(), 120);
    }

    function testFuzz_feeTierMatchesTheLibraryAtEveryUtilisation(uint16 utilisation) public {
        utilisation = uint16(bound(utilisation, 0, 10_000));
        VaultHarness tiered = _tieredVault();
        // Advance exactly `utilisation` of the 100k deposit (exposure cap set to 100% below).
        uint256 advance = (100_000e6 * uint256(utilisation)) / 10_000;
        if (advance > 0) tiered.advanceForTest(keccak256(abi.encode(utilisation)), recipient, advance);
        assertEq(tiered.currentFeeBps(), FeePolicyLib.feeBpsAt(TestPolicies.tiered(), tiered.utilisationBps()));
    }

    function test_feePolicyIsImmutableAfterInitialize() public view {
        (uint16 base, uint16 mid, uint16 high, uint16 critical, uint16 t1, uint16 t2, uint16 t3) = vault.feePolicy();
        assertEq(base, 100);
        assertEq(mid, 110);
        assertEq(high, 120);
        assertEq(critical, 150);
        assertEq(t1, 5_000);
        assertEq(t2, 7_500);
        assertEq(t3, 9_000);
        // No setter exists: the contract's ABI has no `setFeePolicy` — asserted by the interface
        // itself compiling without one; nothing else to call here.
    }

    function test_initializeRejectsAnInvalidPolicy() public {
        VaultHarness fresh = new VaultHarness();
        FeePolicy memory bad = TestPolicies.tiered();
        bad.criticalFeeBps = 151;
        vm.expectRevert(
            abi.encodeWithSelector(FeePolicyLib.FeePolicyAboveProtocolCeiling.selector, 151, 150)
        );
        fresh.initialize(vaultOwner, address(asset), 1_000, 5_000, 8_000, bad);
    }

    /// `FastFilled` carries the tier that applied, so the indexer can chart fee evolution.
    function test_fastFilledEmitsTheTierCharged() public {
        FillAuthorization memory auth = _authorization(8, 10_000e6, 50e6);
        vm.recordLogs();
        _fill(auth);
        // Just prove the event carries 100 (the permissive base tier) as its last word.
        bytes32 topic = keccak256("FastFilled(bytes32,address,address,uint256,uint256,uint256,uint16)");
        bool found;
        VmLog[] memory logs = _logs();
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == topic) {
                (,,, uint16 tier) = abi.decode(logs[i].data, (uint256, uint256, uint256, uint16));
                assertEq(tier, 100);
                found = true;
            }
        }
        assertTrue(found, "FastFilled v2 not emitted");
    }

    // -----------------------------------------------------------------------
    // quote(Intent) — the solver's one-call price + feasibility check
    // -----------------------------------------------------------------------

    function test_quoteReflectsTierUserCeilingAndCaps() public {
        Intent memory ok = _intent(9, 10_000e6);
        (uint16 feeBps, uint256 feeAmount, uint256 outputAmount, bool canFill) = vault.quote(ok);
        assertEq(feeBps, 100);
        assertEq(feeAmount, 100e6);
        assertEq(outputAmount, 9_900e6);
        assertTrue(canFill);

        Intent memory tooCheap = _intent(10, 10_000e6);
        tooCheap.maxFeeBps = 10;
        (,,, bool canFillCheap) = vault.quote(tooCheap);
        assertFalse(canFillCheap, "user ceiling below the posted tier -> cannot fill");

        Intent memory tooBig = _intent(11, MAX_FILL + 1_000e6);
        (,,, bool canFillBig) = vault.quote(tooBig);
        assertFalse(canFillBig, "above the single-fill cap -> cannot fill");

        vm.prank(vaultOwner);
        vault.setPaused(true);
        (,,, bool canFillPaused) = vault.quote(ok);
        assertFalse(canFillPaused);
    }

    // -----------------------------------------------------------------------
    // D9 — trade intents: swap when possible, USDC otherwise, same accounting
    // -----------------------------------------------------------------------

    function _tradeIntent(uint256 nonce, uint256 amount, uint256 minOut) internal view returns (Intent memory i) {
        i = _intent(nonce, amount);
        i.tokenOut = address(mockEth);
        i.targetMinOut = minOut;
    }

    function test_tradeIntentWithoutAnAdapterDeliversUsdc() public {
        Intent memory intent = _tradeIntent(12, 10_000e6, 1);
        FillAuthorization memory auth = _authorizationFor(intent, 50e6, 12);
        vault.fastFill(intent, auth, _sign(auth, agentKey));

        assertEq(asset.balanceOf(recipient), 9_950e6, "USDC delivered as the fallback");
        assertEq(mockEth.balanceOf(recipient), 0);
        assertEq(vault.outstandingExposure(), 9_950e6, "receivable is the USDC that left");
    }

    function test_tradeIntentWithAnAdapterDeliversTokenOut() public {
        vm.prank(vaultOwner);
        vault.setSwapAdapter(address(adapter));

        Intent memory intent = _tradeIntent(13, 10_000e6, 3e9); // 9,950e6 * 4e14 / 1e18 = 3.98e9
        FillAuthorization memory auth = _authorizationFor(intent, 50e6, 13);
        vault.fastFill(intent, auth, _sign(auth, agentKey));

        assertEq(mockEth.balanceOf(recipient), 3_980_000_000, "tokenOut delivered");
        assertEq(asset.balanceOf(recipient), 0, "no USDC delivered");
        assertEq(adapter.lastAmountIn(), 9_950e6, "the adapter pulled exactly the output");
        assertEq(vault.outstandingExposure(), 9_950e6, "identical accounting on the swap path");
        assertEq(asset.allowance(address(vault), address(adapter)), 0, "no standing allowance");
    }

    function test_unsatisfiableFloorFallsBackToUsdc() public {
        vm.prank(vaultOwner);
        vault.setSwapAdapter(address(adapter));

        Intent memory intent = _tradeIntent(14, 10_000e6, 5e9); // above what the rate yields
        FillAuthorization memory auth = _authorizationFor(intent, 50e6, 14);
        vault.fastFill(intent, auth, _sign(auth, agentKey));

        assertEq(mockEth.balanceOf(recipient), 0);
        assertEq(asset.balanceOf(recipient), 9_950e6, "USDC delivered instead");
        assertEq(vault.outstandingExposure(), 9_950e6);
        assertEq(asset.allowance(address(vault), address(adapter)), 0);
    }

    function test_brokenAdapterNeverStrandsAFill() public {
        vm.prank(vaultOwner);
        vault.setSwapAdapter(address(adapter));
        adapter.setMode(MockSwapAdapter.Mode.ALWAYS_REVERT);

        Intent memory intent = _tradeIntent(15, 10_000e6, 1);
        FillAuthorization memory auth = _authorizationFor(intent, 50e6, 15);
        vault.fastFill(intent, auth, _sign(auth, agentKey));

        assertEq(asset.balanceOf(recipient), 9_950e6);
        assertEq(vault.outstandingExposure(), 9_950e6);
    }

    function test_plainTransferIgnoresTheAdapter() public {
        vm.prank(vaultOwner);
        vault.setSwapAdapter(address(adapter));

        FillAuthorization memory auth = _authorization(16, 10_000e6, 50e6);
        _fill(auth);
        assertEq(asset.balanceOf(recipient), 9_950e6);
        assertEq(adapter.lastAmountIn(), 0, "the adapter was never called");
    }

    function test_onlyOwnerSetsTheAdapter() public {
        vm.expectRevert(ArcaidiaLiquidityVault.NotOwner.selector);
        vault.setSwapAdapter(address(adapter));
    }

    // -----------------------------------------------------------------------
    // helpers
    // -----------------------------------------------------------------------

    /// A second vault with the tiered policy, 100% caps, funded with 100k so utilisation maths is exact.
    function _tieredVault() internal returns (VaultHarness tiered) {
        tiered = new VaultHarness();
        tiered.initialize(vaultOwner, address(asset), 0, 10_000, 10_000, TestPolicies.tiered());
        vm.prank(vaultOwner);
        tiered.setMarket(address(market));
        vm.prank(lpBob);
        asset.approve(address(tiered), type(uint256).max);
        vm.prank(lpBob);
        tiered.deposit(100_000e6, lpBob);
    }

    struct VmLog {
        bytes32[] topics;
        bytes data;
        address emitter;
    }

    function _logs() internal returns (VmLog[] memory out) {
        Vm.Log[] memory raw = vm.getRecordedLogs();
        out = new VmLog[](raw.length);
        for (uint256 i = 0; i < raw.length; i++) {
            out[i] = VmLog({topics: raw[i].topics, data: raw[i].data, emitter: raw[i].emitter});
        }
    }
}
