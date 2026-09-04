// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VaultFixture} from "./base/VaultFixture.sol";

/// @notice ERC-4626 rounding direction.
///
/// @dev Every conversion must round against the caller and in the vault's
///      favour. Get one direction wrong and a loop of deposits and redemptions
///      drains the pool a wei at a time — slowly enough that no unit test of a
///      single operation would notice.
///
///      The share price is deliberately made non-round before each assertion:
///      at a 1:1 price every rounding mode agrees, so a suite that only tests
///      a fresh vault proves nothing.
contract VaultRoundingTest is VaultFixture {
    function setUp() public {
        _deployVault();
    }

    /// @dev Advances capital and reimburses more than was advanced, leaving the
    ///      vault with a fee and therefore a share price that is not a round
    ///      number.
    function _makeSharePriceAwkward() internal {
        _deposit(lpAlice, 100_000e6);

        bytes32 intentId = keccak256("rounding");
        vault.advanceForTest(intentId, recipient, 33_333e6);

        vm.prank(vaultOwner);
        vault.setSettlementReceiver(address(this));

        asset.mint(address(this), 33_334e6);
        asset.approve(address(vault), type(uint256).max);
        vault.recordReimbursement(intentId, 33_334e6);
    }

    function test_sharePriceIsNotRoundAfterAFee() public {
        _makeSharePriceAwkward();
        // 100,001 assets against the original share supply: not a whole ratio.
        assertEq(vault.totalAssets(), 100_001e6);
        assertGt(vault.previewRedeem(1e12), 1e6);
    }

    // -----------------------------------------------------------------------
    // Direction of each conversion
    // -----------------------------------------------------------------------

    /// Depositing rounds shares *down*: the depositor never receives a share
    /// they did not fully pay for.
    function test_previewDepositRoundsDown() public {
        _makeSharePriceAwkward();

        uint256 assets = 12_345_678;
        uint256 shares = vault.previewDeposit(assets);

        // Converting back can never exceed what was put in.
        assertLe(vault.previewRedeem(shares), assets);
    }

    /// Minting rounds assets *up*: the minter pays at least what the shares are
    /// worth, never less.
    function test_previewMintRoundsUp() public {
        _makeSharePriceAwkward();

        uint256 shares = 12_345_678_901;
        uint256 assets = vault.previewMint(shares);

        assertGe(assets, vault.previewRedeem(shares));
    }

    /// Withdrawing rounds shares *up*: the withdrawer burns at least enough.
    function test_previewWithdrawRoundsUp() public {
        _makeSharePriceAwkward();

        uint256 assets = 12_345_678;
        uint256 shares = vault.previewWithdraw(assets);

        assertGe(vault.previewRedeem(shares), assets - 1);
        assertGe(shares, vault.previewDeposit(assets));
    }

    /// Redeeming rounds assets *down*: the redeemer never takes more than their
    /// shares are worth.
    function test_previewRedeemRoundsDown() public {
        _makeSharePriceAwkward();

        uint256 shares = 12_345_678_901;
        uint256 assets = vault.previewRedeem(shares);

        assertGe(vault.previewWithdraw(assets), 0);
        assertLe(assets, vault.previewMint(shares));
    }

    /// The pairing that matters: minting costs at least what redeeming returns.
    /// If it did not, minting and redeeming in a loop would extract value.
    function test_mintCostsAtLeastWhatRedeemReturns() public {
        _makeSharePriceAwkward();

        for (uint256 shares = 1; shares < 1e9; shares *= 7) {
            assertGe(
                vault.previewMint(shares),
                vault.previewRedeem(shares),
                "mint must never cost less than redeem returns"
            );
        }
    }

    /// And its mirror: withdrawing burns at least what depositing would mint.
    function test_withdrawBurnsAtLeastWhatDepositMints() public {
        _makeSharePriceAwkward();

        for (uint256 assets = 1; assets < 1e9; assets *= 7) {
            assertGe(
                vault.previewWithdraw(assets),
                vault.previewDeposit(assets),
                "withdraw must never burn fewer shares than deposit mints"
            );
        }
    }

    // -----------------------------------------------------------------------
    // No sequence extracts value
    // -----------------------------------------------------------------------

    /// A single round trip at an awkward price must not profit the caller.
    function testFuzz_roundTripNeverProfitsAtAnAwkwardPrice(uint96 rawAssets) public {
        _makeSharePriceAwkward();
        uint256 assets = bound(rawAssets, 1e6, 200_000e6);

        asset.mint(lpBob, assets);
        vm.startPrank(lpBob);
        asset.approve(address(vault), type(uint256).max);
        uint256 before = asset.balanceOf(lpBob);

        uint256 shares = vault.deposit(assets, lpBob);
        uint256 returned = shares == 0 ? 0 : vault.redeem(shares, lpBob, lpBob);
        vm.stopPrank();

        assertLe(returned, assets, "round trip profited the caller");
        assertLe(asset.balanceOf(lpBob), before);
    }

    /// Repeating the round trip must not accumulate a profit either. A single
    /// round trip losing nothing is compatible with a loop that gains a wei
    /// each time; this is the test that rules that out.
    function test_repeatedRoundTripsNeverAccumulateProfit() public {
        _makeSharePriceAwkward();

        uint256 stake = 9_999e6;
        asset.mint(lpBob, stake);

        vm.startPrank(lpBob);
        asset.approve(address(vault), type(uint256).max);
        uint256 opening = asset.balanceOf(lpBob);

        for (uint256 i = 0; i < 25; i++) {
            uint256 balance = asset.balanceOf(lpBob);
            if (balance == 0) break;
            uint256 shares = vault.deposit(balance, lpBob);
            if (shares == 0) break;
            vault.redeem(shares, lpBob, lpBob);
        }
        vm.stopPrank();

        assertLe(asset.balanceOf(lpBob), opening, "a loop of round trips extracted value");
    }

    /// Existing LPs must never be worse off after someone else's round trip.
    function test_othersRoundTripsDoNotHarmExistingLps() public {
        _makeSharePriceAwkward();
        uint256 aliceShares = vault.balanceOf(lpAlice);
        uint256 aliceValueBefore = vault.previewRedeem(aliceShares);

        asset.mint(lpBob, 50_000e6);
        vm.startPrank(lpBob);
        asset.approve(address(vault), type(uint256).max);
        for (uint256 i = 0; i < 10; i++) {
            uint256 shares = vault.deposit(5_000e6, lpBob);
            vault.redeem(shares, lpBob, lpBob);
        }
        vm.stopPrank();

        assertGe(vault.previewRedeem(aliceShares), aliceValueBefore, "an existing LP was made worse off");
    }
}
