// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VaultFixture} from "./base/VaultFixture.sol";
import {ArcaidiaLiquidityVault} from "../src/ArcaidiaLiquidityVault.sol";

/// @notice The 50/50 fee split and the treasury sweep.
///
/// @dev The property under test throughout: protocol fees sit inside the vault
///      but are **not LP capital**. They must be invisible to every question an
///      LP can ask — share price, withdrawable balance, deployable liquidity —
///      or LPs would be credited with money that belongs to the treasury and
///      could redeem against it.
contract ProtocolFeesTest is VaultFixture {
    address internal treasury = makeAddr("treasury");
    uint16 internal constant SPLIT = 5_000; // 50%

    function setUp() public {
        _deployVault();

        vm.startPrank(vaultOwner);
        vault.setSettlementReceiver(address(this));
        vault.setTreasury(treasury);
        vault.setProtocolFeeShareBps(SPLIT);
        vm.stopPrank();

        _deposit(lpAlice, 100_000e6);
        asset.mint(address(this), 500_000e6);
        asset.approve(address(vault), type(uint256).max);
    }

    function _intentId(uint256 seed) internal pure returns (bytes32) {
        return keccak256(abi.encode("fee-intent", seed));
    }

    /// Advance `output`, then have canonical settlement return `output + fee`.
    function _cycle(uint256 seed, uint256 output, uint256 fee) internal returns (bytes32 intentId) {
        intentId = _intentId(seed);
        vault.advanceForTest(intentId, recipient, output);
        vault.recordReimbursement(intentId, output + fee);
    }

    // -----------------------------------------------------------------------
    // The split
    // -----------------------------------------------------------------------

    function test_halfTheFeeAccruesToTheProtocol() public {
        _cycle(1, 10_000e6, 100e6);
        assertEq(vault.accruedProtocolFees(), 50e6, "protocol takes half");
    }

    function test_theOtherHalfLiftsTheSharePrice() public {
        uint256 shares = vault.balanceOf(lpAlice);
        uint256 before = vault.previewRedeem(shares);

        _cycle(2, 10_000e6, 100e6);

        assertEq(vault.previewRedeem(shares) - before, 50e6 - 1, "LPs take the other half");
    }

    function test_totalAssetsGrowsByTheLpShareOnly() public {
        _cycle(3, 10_000e6, 100e6);
        assertEq(vault.totalAssets(), 100_000e6 + 50e6);
    }

    /// The vault holds the whole fee; only half of it is LP capital.
    function test_heldBalanceExceedsLpAssetsByTheProtocolShare() public {
        _cycle(4, 10_000e6, 100e6);
        assertEq(vault.liquidBalance() - vault.lpLiquidBalance(), 50e6);
        assertEq(vault.liquidBalance(), vault.totalAssets() + 50e6);
    }

    function test_splitIsConfigurable() public {
        vm.prank(vaultOwner);
        vault.setProtocolFeeShareBps(2_500);

        _cycle(5, 10_000e6, 100e6);
        assertEq(vault.accruedProtocolFees(), 25e6);
    }

    function test_zeroSplitGivesEverythingToLps() public {
        vm.prank(vaultOwner);
        vault.setProtocolFeeShareBps(0);

        _cycle(6, 10_000e6, 100e6);
        assertEq(vault.accruedProtocolFees(), 0);
        assertEq(vault.totalAssets(), 100_000e6 + 100e6);
    }

    /// Rounding on an odd fee favours LPs, not the protocol. We are the
    /// protocol; giving ourselves the rounding error would be the wrong default.
    function test_oddFeeRoundsTowardLps() public {
        _cycle(7, 10_000e6, 3);
        assertEq(vault.accruedProtocolFees(), 1, "protocol rounds down");
    }

    function test_feesAccumulateAcrossIntents() public {
        _cycle(8, 5_000e6, 40e6);
        _cycle(9, 5_000e6, 60e6);
        assertEq(vault.accruedProtocolFees(), 50e6);
    }

    // -----------------------------------------------------------------------
    // Protocol fees are invisible to LPs
    // -----------------------------------------------------------------------

    /// The decisive test. An LP redeeming everything must not be able to take
    /// the treasury's money with them.
    function test_lpRedeemingEverythingLeavesTheProtocolFeesBehind() public {
        _cycle(10, 10_000e6, 100e6);

        uint256 shares = vault.balanceOf(lpAlice);
        vm.prank(lpAlice);
        vault.redeem(shares, lpAlice, lpAlice);

        assertEq(vault.accruedProtocolFees(), 50e6, "treasury's share untouched");
        assertGe(vault.liquidBalance(), 50e6, "the money is still there");
        assertLe(vault.totalAssets(), 1, "no LP assets remain");
    }

    function test_maxWithdrawExcludesProtocolFees() public {
        _cycle(11, 10_000e6, 100e6);
        assertLe(vault.maxWithdraw(lpAlice), vault.liquidBalance() - 50e6);
    }

    /// Protocol fees are not lendable. They are owed out, not deployable.
    function test_availableLiquidityExcludesProtocolFees() public {
        _cycle(12, 10_000e6, 100e6);

        uint256 lpAssets = vault.totalAssets();
        assertEq(vault.availableLiquidity(), vault.lpLiquidBalance() - vault.reserveFloor());
        assertLt(vault.availableLiquidity(), vault.liquidBalance() - vault.reserveFloor());
        assertEq(lpAssets, vault.lpLiquidBalance(), "no receivable outstanding here");
    }

    // -----------------------------------------------------------------------
    // The sweep
    // -----------------------------------------------------------------------

    function test_withdrawFeesSendsToTheTreasury() public {
        _cycle(13, 10_000e6, 100e6);

        vm.prank(vaultOwner);
        uint256 swept = vault.withdrawFees();

        assertEq(swept, 50e6);
        assertEq(asset.balanceOf(treasury), 50e6);
        assertEq(vault.accruedProtocolFees(), 0);
    }

    /// Sweeping must not touch LP capital.
    function test_sweepingDoesNotMoveTheSharePrice() public {
        _cycle(14, 10_000e6, 100e6);

        uint256 shares = vault.balanceOf(lpAlice);
        uint256 before = vault.previewRedeem(shares);

        vm.prank(vaultOwner);
        vault.withdrawFees();

        assertEq(vault.previewRedeem(shares), before, "LPs unaffected by the sweep");
        assertEq(vault.totalAssets(), 100_000e6 + 50e6);
    }

    function test_onlyOwnerCanSweep() public {
        _cycle(15, 10_000e6, 100e6);

        vm.prank(lpBob);
        vm.expectRevert(ArcaidiaLiquidityVault.NotOwner.selector);
        vault.withdrawFees();
    }

    function test_sweepRevertsWithNoTreasurySet() public {
        ArcaidiaLiquidityVault fresh = new ArcaidiaLiquidityVault();
        fresh.initialize(vaultOwner, address(asset), 1_000);

        vm.prank(vaultOwner);
        vm.expectRevert(ArcaidiaLiquidityVault.TreasuryNotSet.selector);
        fresh.withdrawFees();
    }

    function test_sweepRevertsWithNothingAccrued() public {
        vm.prank(vaultOwner);
        vm.expectRevert(ArcaidiaLiquidityVault.NoFeesAccrued.selector);
        vault.withdrawFees();
    }

    function test_sweepingTwiceTakesNothingTheSecondTime() public {
        _cycle(16, 10_000e6, 100e6);

        vm.startPrank(vaultOwner);
        vault.withdrawFees();
        vm.expectRevert(ArcaidiaLiquidityVault.NoFeesAccrued.selector);
        vault.withdrawFees();
        vm.stopPrank();

        assertEq(asset.balanceOf(treasury), 50e6, "swept exactly once");
    }

    /// The owner key can move fees and nothing else. This is the bound on what
    /// a compromised owner could take.
    function test_theOwnerCannotReachLpCapitalThroughWithdrawFees() public {
        _cycle(17, 10_000e6, 100e6);
        uint256 lpAssetsBefore = vault.totalAssets();

        vm.prank(vaultOwner);
        uint256 swept = vault.withdrawFees();

        assertEq(swept, 50e6, "only the fees moved");
        assertEq(vault.totalAssets(), lpAssetsBefore, "LP assets untouched");
    }

    function test_treasuryIsSettable() public {
        address next = makeAddr("newTreasury");
        vm.prank(vaultOwner);
        vault.setTreasury(next);
        assertEq(vault.treasury(), next);

        _cycle(18, 10_000e6, 100e6);
        vm.prank(vaultOwner);
        vault.withdrawFees();
        assertEq(asset.balanceOf(next), 50e6);
    }

    function test_onlyOwnerCanConfigure() public {
        vm.startPrank(lpBob);
        vm.expectRevert(ArcaidiaLiquidityVault.NotOwner.selector);
        vault.setTreasury(lpBob);
        vm.expectRevert(ArcaidiaLiquidityVault.NotOwner.selector);
        vault.setProtocolFeeShareBps(10_000);
        vm.stopPrank();
    }

    function test_rejectsAShareAboveOneHundredPercent() public {
        vm.prank(vaultOwner);
        vm.expectRevert(abi.encodeWithSelector(ArcaidiaLiquidityVault.ShareAboveDenominator.selector, 10_001));
        vault.setProtocolFeeShareBps(10_001);
    }

    function test_rejectsAZeroTreasury() public {
        vm.prank(vaultOwner);
        vm.expectRevert(ArcaidiaLiquidityVault.ZeroAddress.selector);
        vault.setTreasury(address(0));
    }

    // -----------------------------------------------------------------------
    // Fuzz
    // -----------------------------------------------------------------------

    /// However the fee falls, the two halves must add up and LPs must never be
    /// charged more than the configured share.
    function testFuzz_theSplitAlwaysReconciles(uint96 rawFee, uint16 rawShare) public {
        uint256 fee = bound(rawFee, 0, 1_000e6);
        uint16 share = uint16(bound(rawShare, 0, 10_000));

        vm.prank(vaultOwner);
        vault.setProtocolFeeShareBps(share);

        uint256 lpAssetsBefore = vault.totalAssets();
        _cycle(uint256(rawFee) + 1000, 10_000e6, fee);

        uint256 toProtocol = vault.accruedProtocolFees();
        uint256 toLps = vault.totalAssets() - lpAssetsBefore;

        assertEq(toProtocol + toLps, fee, "the halves must reconcile to the whole fee");
        assertLe(toProtocol, (fee * share) / 10_000, "protocol never takes more than its share");
    }
}
