// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {FastFillFixture} from "./base/FastFillFixture.sol";
import {NeverSettledCheck} from "./base/VaultFixture.sol";
import {ArcaidiaLiquidityVault} from "../src/ArcaidiaLiquidityVault.sol";
import {ArcaidiaIntentMarket} from "../src/ArcaidiaIntentMarket.sol";
import {ISettlementCheck} from "../src/interfaces/ISettlementCheck.sol";
import {VaultHarness} from "./harness/VaultHarness.sol";
import {FillAuthorization} from "../src/libraries/ArcaidiaTypes.sol";

/// @notice WP-10 hardening: `fastFill` must refuse an intent `SettlementReceiver`
///         already settled canonically.
///
/// @dev The race this closes: nobody fast-fills an intent, so once the real CCTP
///      mint lands, `SettlementReceiver.settle()` takes its fallback branch and
///      pays the recipient directly — without ever calling this vault, since
///      that branch has no reason to. Before this check, a later `fastFill` for
///      the same `intentId` would find `intentFilled` still false and pay the
///      recipient a second time, entirely out of LP capital, with no burn ever
///      backing it. This test contract doubles as `settlementReceiver`, the
///      same pattern `VaultReentrancyTest` uses, so it can flip settled state
///      directly rather than driving a real `SettlementReceiver` end to end.
contract FastFillSettlementCheckTest is FastFillFixture {
    bool internal settled;

    function setUp() public {
        _deployWithAgent();
        vm.prank(vaultOwner);
        vault.setSettlementReceiver(address(this));
    }

    function isSettled(bytes32) external view returns (bool) {
        return settled;
    }

    // -----------------------------------------------------------------------

    function test_fillProceedsWhenNotYetSettled() public {
        FillAuthorization memory auth = _authorization(1, 10_000e6, 50e6);
        address signer = _fill(auth);

        assertEq(signer, agent);
        assertEq(asset.balanceOf(recipient), 9_950e6);
    }

    /// The gap this closes: a fallback payout already happened; a late fill
    /// for the same intent must be refused, not paid twice.
    function test_fillRefusedAfterCanonicalFallbackAlreadyPaid() public {
        FillAuthorization memory auth = _authorization(2, 10_000e6, 50e6);
        settled = true;

        _fillExpectingRevert(
            auth,
            abi.encodeWithSelector(
                ArcaidiaLiquidityVault.IntentAlreadySettledCanonically.selector, auth.intentId
            )
        );

        assertEq(asset.balanceOf(recipient), 0, "no LP capital should move once canonically settled");
        assertFalse(vault.isFilled(auth.intentId), "a refused fill must not be recorded as filled");
    }

    /// A stale local read must not survive: if `SettlementReceiver` reports
    /// settled *between* two otherwise-identical calls, the second must revert
    /// even though the first succeeded.
    function test_fillRefusedOnceSettledEvenIfEarlierFillsSucceeded() public {
        _fill(_authorization(3, 10_000e6, 50e6));
        assertEq(asset.balanceOf(recipient), 9_950e6);

        settled = true;
        FillAuthorization memory later = _authorization(4, 5_000e6, 25e6);
        _fillExpectingRevert(
            later,
            abi.encodeWithSelector(
                ArcaidiaLiquidityVault.IntentAlreadySettledCanonically.selector, later.intentId
            )
        );
    }

    /// `settlementReceiver` unset (address(0)) — the state every vault starts
    /// in before deployment wiring runs — must not brick every fill. A fresh
    /// vault instance, never pointed at a receiver, stands in here since
    /// `setSettlementReceiver` itself refuses `address(0)`.
    function test_unsetSettlementReceiverDoesNotBlockFills() public {
        VaultHarness fresh = new VaultHarness();
        fresh.initialize(vaultOwner, address(asset), RESERVE_FLOOR_BPS);
        ArcaidiaIntentMarket freshMarket =
            new ArcaidiaIntentMarket(ISettlementCheck(address(new NeverSettledCheck())));

        vm.startPrank(vaultOwner);
        fresh.setFillLimits(MAX_FILL_BPS, MAX_EXPOSURE_BPS, MAX_FEE_BPS);
        fresh.setAuthorisedSigner(agent, true);
        fresh.setMarket(address(freshMarket));
        vm.stopPrank();

        asset.mint(lpAlice, 100_000e6);
        vm.prank(lpAlice);
        asset.approve(address(fresh), type(uint256).max);
        vm.prank(lpAlice);
        fresh.deposit(100_000e6, lpAlice);

        FillAuthorization memory auth = _authorization(5, 10_000e6, 50e6);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(agentKey, fresh.hashFillAuthorization(auth));
        address signer = fresh.fastFill(auth, abi.encodePacked(r, s, v));

        assertEq(signer, agent);
        assertEq(asset.balanceOf(recipient), 9_950e6);
    }
}
