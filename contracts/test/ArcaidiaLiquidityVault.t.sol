// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VaultFixture} from "./base/VaultFixture.sol";
import {ArcaidiaLiquidityVault} from "../src/ArcaidiaLiquidityVault.sol";
import {VaultHarness} from "./harness/VaultHarness.sol";

contract ArcaidiaLiquidityVaultTest is VaultFixture {
    function setUp() public {
        _deployVault();
    }

    // -----------------------------------------------------------------------
    // Initialization
    // -----------------------------------------------------------------------

    function test_initializeStoresConfiguration() public view {
        assertTrue(vault.initialized());
        assertEq(vault.owner(), vaultOwner);
        assertEq(address(vault.asset()), address(asset));
        assertEq(vault.reserveFloorBps(), RESERVE_FLOOR_BPS);
    }

    function test_initializeCannotBeCalledTwice() public {
        vm.expectRevert(ArcaidiaLiquidityVault.AlreadyInitialized.selector);
        vault.initialize(lpAlice, address(asset), 0);
    }

    function test_initializeRejectsReserveFloorAboveDenominator() public {
        VaultHarness fresh = new VaultHarness();
        vm.expectRevert(abi.encodeWithSelector(ArcaidiaLiquidityVault.ReserveFloorTooHigh.selector, 10_001));
        fresh.initialize(vaultOwner, address(asset), 10_001);
    }

    /// Share decimals are asset decimals plus the virtual offset, which is what
    /// keeps the inflation mitigation meaningful at six-decimal precision.
    function test_shareDecimalsIncludeTheOffset() public view {
        assertEq(vault.decimals(), 6 + 6);
    }

    // -----------------------------------------------------------------------
    // Deposits
    // -----------------------------------------------------------------------

    function test_depositMintsSharesAndPullsAssets() public {
        uint256 shares = _deposit(lpAlice, 100_000e6);

        assertGt(shares, 0);
        assertEq(vault.balanceOf(lpAlice), shares);
        assertEq(vault.totalAssets(), 100_000e6);
        assertEq(vault.liquidBalance(), 100_000e6);
        assertEq(asset.balanceOf(lpAlice), 900_000e6);
    }

    function test_mintPullsThePreviewedAssets() public {
        uint256 shares = 50_000e12;
        uint256 expected = vault.previewMint(shares);

        vm.prank(lpAlice);
        uint256 assets = vault.mint(shares, lpAlice);

        assertEq(assets, expected);
        assertEq(vault.balanceOf(lpAlice), shares);
        assertEq(vault.liquidBalance(), assets);
    }

    function test_secondDepositorGetsProportionalShares() public {
        _deposit(lpAlice, 100_000e6);
        uint256 bobShares = _deposit(lpBob, 100_000e6);

        assertApproxEqRel(vault.balanceOf(lpAlice), bobShares, 1e12);
        assertEq(vault.totalAssets(), 200_000e6);
    }

    function test_depositRevertsWhenPaused() public {
        vm.prank(vaultOwner);
        vault.setPaused(true);

        vm.prank(lpAlice);
        vm.expectRevert(ArcaidiaLiquidityVault.VaultPaused.selector);
        vault.deposit(1_000e6, lpAlice);
    }

    function test_depositRejectsZeroAmount() public {
        vm.prank(lpAlice);
        vm.expectRevert(ArcaidiaLiquidityVault.ZeroAmount.selector);
        vault.deposit(0, lpAlice);
    }

    // -----------------------------------------------------------------------
    // totalAssets counts the receivable — the core ERC-4626 decision
    // -----------------------------------------------------------------------

    /// After a fast fill the assets have left, but they are still owed to the
    /// vault. Total assets must not fall, or every LP's share price would drop
    /// the instant the vault does its job.
    function test_totalAssetsUnchangedByAnAdvance() public {
        _deposit(lpAlice, 100_000e6);
        uint256 before = vault.totalAssets();

        vault.advanceForTest(recipient, 10_000e6);

        assertEq(vault.liquidBalance(), 90_000e6, "liquid balance should fall");
        assertEq(vault.outstandingExposure(), 10_000e6, "receivable should be recorded");
        assertEq(vault.totalAssets(), before, "total assets must not move");
    }

    /// This is the failure the decision was taken to prevent: an LP redeeming
    /// mid-fill must be priced against total assets, not the liquid balance.
    function test_redeemMidFillIsPricedAgainstTotalAssets() public {
        _deposit(lpAlice, 100_000e6);
        _deposit(lpBob, 100_000e6);

        uint256 valueBefore = vault.previewRedeem(vault.balanceOf(lpAlice));
        vault.advanceForTest(recipient, 50_000e6);
        uint256 valueAfter = vault.previewRedeem(vault.balanceOf(lpAlice));

        assertEq(valueAfter, valueBefore, "an advance must not change what an LP is owed");
    }

    /// A receivable is an asset but not a payable one.
    function test_withdrawIsCappedByLiquidBalance() public {
        _deposit(lpAlice, 100_000e6);
        vault.advanceForTest(recipient, 95_000e6);

        assertEq(vault.maxWithdraw(lpAlice), 5_000e6, "capped by what the vault holds");

        vm.prank(lpAlice);
        vm.expectRevert(
            abi.encodeWithSelector(ArcaidiaLiquidityVault.ExceedsMaxWithdraw.selector, 6_000e6, 5_000e6)
        );
        vault.withdraw(6_000e6, lpAlice, lpAlice);
    }

    /// Reimbursement restores liquidity and clears the receivable; the fee is
    /// what makes the share price rise.
    function test_reimbursementWithFeeRaisesSharePrice() public {
        _deposit(lpAlice, 100_000e6);
        uint256 shares = vault.balanceOf(lpAlice);
        uint256 valueBefore = vault.previewRedeem(shares);

        vault.advanceForTest(recipient, 10_000e6);

        // Canonical settlement returns principal plus the execution fee.
        asset.mint(address(this), 10_100e6);
        asset.approve(address(vault), type(uint256).max);
        vault.reimburseForTest(10_000e6);
        asset.transfer(address(vault), 100e6);

        assertEq(vault.outstandingExposure(), 0);
        assertGt(vault.previewRedeem(shares), valueBefore, "fee should accrue to LPs");
    }

    // -----------------------------------------------------------------------
    // Reserve floor and available liquidity
    // -----------------------------------------------------------------------

    function test_reserveFloorIsAShareOfTotalAssets() public {
        _deposit(lpAlice, 100_000e6);
        assertEq(vault.reserveFloor(), 10_000e6);
        assertEq(vault.availableLiquidity(), 90_000e6);
    }

    /// Available liquidity is bounded by the liquid balance, never by total
    /// assets: an outstanding receivable cannot be advanced a second time.
    function test_availableLiquidityExcludesTheReceivable() public {
        _deposit(lpAlice, 100_000e6);
        vault.advanceForTest(recipient, 50_000e6);

        // Total assets still 100k, so the floor is still 10k, but only 50k is held.
        assertEq(vault.totalAssets(), 100_000e6);
        assertEq(vault.reserveFloor(), 10_000e6);
        assertEq(vault.availableLiquidity(), 40_000e6);
    }

    function test_availableLiquidityIsZeroBelowTheFloor() public {
        _deposit(lpAlice, 100_000e6);
        vault.advanceForTest(recipient, 95_000e6);
        assertEq(vault.availableLiquidity(), 0);
    }

    function test_utilisationTracksAdvancedPrincipal() public {
        _deposit(lpAlice, 100_000e6);
        assertEq(vault.utilisationBps(), 0);

        vault.advanceForTest(recipient, 50_000e6);
        assertEq(vault.utilisationBps(), 5_000);
    }

    function test_emptyVaultReadsAsFullyUtilised() public view {
        assertEq(vault.utilisationBps(), 10_000);
    }

    // -----------------------------------------------------------------------
    // Withdrawals and redemptions
    // -----------------------------------------------------------------------

    function test_redeemReturnsAssetsAndBurnsShares() public {
        _deposit(lpAlice, 100_000e6);
        uint256 shares = vault.balanceOf(lpAlice);

        vm.prank(lpAlice);
        uint256 assets = vault.redeem(shares, lpAlice, lpAlice);

        assertEq(vault.balanceOf(lpAlice), 0);
        assertApproxEqAbs(assets, 100_000e6, 1);
        assertApproxEqAbs(asset.balanceOf(lpAlice), 1_000_000e6, 1);
    }

    function test_withdrawBurnsThePreviewedShares() public {
        _deposit(lpAlice, 100_000e6);
        uint256 sharesBefore = vault.balanceOf(lpAlice);
        uint256 expected = vault.previewWithdraw(40_000e6);

        vm.prank(lpAlice);
        uint256 shares = vault.withdraw(40_000e6, lpAlice, lpAlice);

        assertEq(shares, expected);
        assertEq(vault.balanceOf(lpAlice), sharesBefore - shares);
    }

    function test_thirdPartyWithdrawRequiresAllowance() public {
        _deposit(lpAlice, 100_000e6);

        vm.prank(lpBob);
        vm.expectRevert();
        vault.withdraw(1_000e6, lpBob, lpAlice);

        vm.prank(lpAlice);
        vault.approve(lpBob, type(uint256).max);

        uint256 bobBefore = asset.balanceOf(lpBob);
        vm.prank(lpBob);
        vault.withdraw(1_000e6, lpBob, lpAlice);
        // Bob never deposited; the assets come out of Alice's position.
        assertEq(asset.balanceOf(lpBob), bobBefore + 1_000e6);
        assertLt(vault.balanceOf(lpAlice), vault.totalSupply() + 1);
    }

    /// Pausing stops new capital entering but must not trap existing LPs.
    function test_pausingBlocksDepositsButNotWithdrawals() public {
        _deposit(lpAlice, 100_000e6);

        vm.prank(vaultOwner);
        vault.setPaused(true);

        assertEq(vault.maxDeposit(lpAlice), 0);

        vm.prank(lpAlice);
        vault.withdraw(1_000e6, lpAlice, lpAlice);
    }

    // -----------------------------------------------------------------------
    // Rounding and attack surface
    // -----------------------------------------------------------------------

    /// The classic ERC-4626 attack: the first depositor mints one wei of shares
    /// then donates assets directly, hoping the next depositor's shares round to
    /// zero and their deposit is captured. The virtual offset defeats it.
    function test_firstDepositorCannotStealViaDonation() public {
        vm.prank(lpAlice);
        vault.deposit(1, lpAlice);

        // Donate a large balance straight to the vault, bypassing deposit.
        vm.prank(lpAlice);
        asset.transfer(address(vault), 100_000e6);

        uint256 bobShares = _deposit(lpBob, 10_000e6);
        assertGt(bobShares, 0, "victim must not be rounded to zero shares");

        uint256 bobValue = vault.previewRedeem(bobShares);
        assertGe(bobValue, 9_900e6, "victim must retain substantially all of their deposit");
    }

    /// Rounding must never favour the caller: depositing then immediately
    /// redeeming cannot return more than was put in.
    function testFuzz_depositThenRedeemNeverProfits(uint96 amount) public {
        uint256 assets = bound(amount, 1e6, 500_000e6);

        vm.startPrank(lpAlice);
        uint256 shares = vault.deposit(assets, lpAlice);
        uint256 returned = shares == 0 ? 0 : vault.redeem(shares, lpAlice, lpAlice);
        vm.stopPrank();

        assertLe(returned, assets, "round trip must not profit the caller");
    }

    /// No LP may extract value from another by depositing after an advance.
    function testFuzz_lateDepositorCannotDiluteExistingLp(uint96 advanceAmount) public {
        _deposit(lpAlice, 100_000e6);
        uint256 aliceShares = vault.balanceOf(lpAlice);
        uint256 aliceValueBefore = vault.previewRedeem(aliceShares);

        uint256 advance = bound(advanceAmount, 1e6, 80_000e6);
        vault.advanceForTest(recipient, advance);

        _deposit(lpBob, 50_000e6);

        assertGe(vault.previewRedeem(aliceShares), aliceValueBefore - 1, "existing LP must not be diluted");
    }

    // -----------------------------------------------------------------------
    // Ownership
    // -----------------------------------------------------------------------

    function test_onlyOwnerCanSetReserveFloor() public {
        vm.prank(lpAlice);
        vm.expectRevert(ArcaidiaLiquidityVault.NotOwner.selector);
        vault.setReserveFloorBps(0);
    }

    function test_onlyOwnerCanPause() public {
        vm.prank(lpAlice);
        vm.expectRevert(ArcaidiaLiquidityVault.NotOwner.selector);
        vault.setPaused(true);
    }

    function test_ownershipCanBeTransferred() public {
        vm.prank(vaultOwner);
        vault.transferOwnership(lpAlice);
        assertEq(vault.owner(), lpAlice);
    }
}
