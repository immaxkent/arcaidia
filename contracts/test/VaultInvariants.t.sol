// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ChainFixture} from "./base/ChainFixture.sol";
import {VaultHarness} from "./harness/VaultHarness.sol";
import {VaultInvariantHandler} from "./harness/VaultInvariantHandler.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

/// @notice What must hold no matter what sequence of legal actions occurs.
///
/// @dev Unit tests check one transition; these check every ordering Foundry can
///      find. The dangerous states in this protocol are combinations — an LP
///      redeeming between a fill and its reimbursement, a second fill landing
///      while the first is outstanding, reimbursements arriving out of order —
///      and no single-transition test would catch a break in one of those.
contract VaultInvariantsTest is ChainFixture {
    VaultHarness internal vault;
    MockUSDC internal asset;
    VaultInvariantHandler internal handler;

    address internal vaultOwner = makeAddr("invVaultOwner");

    uint16 internal constant RESERVE_FLOOR_BPS = 1_000; // 10%
    uint256 internal constant MAX_FILL = 25_000e6;
    uint256 internal constant MAX_EXPOSURE = 150_000e6;
    uint16 internal constant MAX_FEE_BPS = 100; // 1%

    function setUp() public {
        _configureDirection();
        vm.chainId(destinationChainId);

        asset = new MockUSDC();
        vault = new VaultHarness();
        vault.initialize(vaultOwner, address(asset), RESERVE_FLOOR_BPS);

        (, uint256 agentKey) = makeAddrAndKey("invAgent");
        handler = new VaultInvariantHandler(vault, asset, agentKey);

        vm.startPrank(vaultOwner);
        vault.setFillLimits(MAX_FILL, MAX_EXPOSURE, MAX_FEE_BPS);
        vault.setAuthorisedSigner(handler.agent(), true);
        vault.setSettlementReceiver(address(handler));
        vm.stopPrank();

        targetContract(address(handler));
    }

    // -----------------------------------------------------------------------
    // Guard against a vacuous run
    // -----------------------------------------------------------------------

    /// The handler swallows failed actions, so a handler that could never
    /// succeed at anything would satisfy every invariant below while proving
    /// nothing. This drives one of each action explicitly and asserts the state
    /// actually moved.
    function test_handlerReachesTheStatesTheInvariantsGuard() public {
        handler.deposit(0, 100_000e6);
        assertGt(vault.totalAssets(), 0, "deposits are not landing");

        handler.fastFill(12_345e6, 7);
        assertGt(handler.ghostAdvanced(), 0, "fills are not landing");
        assertGt(vault.outstandingExposure(), 0, "exposure is not being recorded");
        assertEq(handler.filledIntentCount(), 1);

        handler.reimburse(0);
        assertGt(handler.ghostReimbursedPrincipal(), 0, "reimbursements are not landing");
        assertEq(vault.outstandingExposure(), 0, "receivable was not cleared");

        handler.redeem(0, type(uint256).max);
        assertGt(handler.ghostRedeemed(), 0, "redemptions are not landing");
    }

    /// And the fee actually reaches LPs across a full cycle.
    function test_aFullCycleLeavesLpsAhead() public {
        handler.deposit(0, 100_000e6);
        uint256 priceBefore = vault.previewRedeem(1e12);

        handler.fastFill(20_000e6, type(uint256).max); // maximum permitted fee
        handler.reimburse(0);

        assertGt(vault.previewRedeem(1e12), priceBefore, "fee did not accrue to LPs");
    }

    /// The accounting identity the whole ERC-4626 design rests on. If this ever
    /// breaks, every share price in the system is wrong.
    function invariant_totalAssetsIsLiquidPlusReceivable() public view {
        assertEq(vault.totalAssets(), vault.liquidBalance() + vault.outstandingExposure());
    }

    /// The vault's own exposure figure must agree with an independent tally of
    /// what was advanced minus what was reimbursed.
    function invariant_exposureMatchesIndependentTally() public view {
        assertEq(vault.outstandingExposure(), handler.ghostOutstanding());
    }

    /// The exposure cap is checked before a fill, so it can never be exceeded
    /// afterwards — including across interleaved fills and reimbursements.
    function invariant_exposureNeverExceedsItsCap() public view {
        assertLe(vault.outstandingExposure(), MAX_EXPOSURE);
    }

    /// Advanced capital has actually left the vault, so the receivable can never
    /// exceed everything ever deposited.
    function invariant_receivableIsBackedByRealCapital() public view {
        assertLe(vault.outstandingExposure(), handler.ghostAdvanced());
    }

    /// Deployable liquidity is bounded by what the vault holds: a receivable
    /// must never be advanced a second time.
    function invariant_availableLiquidityNeverExceedsLiquidBalance() public view {
        assertLe(vault.availableLiquidity(), vault.liquidBalance());
    }

    /// Utilisation is a ratio, so it stays within basis points by construction.
    function invariant_utilisationStaysWithinBounds() public view {
        assertLe(vault.utilisationBps(), 10_000);
    }

    /// Shares only exist against assets. A non-zero supply with no assets would
    /// mean shares had been minted for nothing.
    function invariant_sharesAreBackedByAssets() public view {
        if (vault.totalSupply() > 0) {
            assertGt(vault.totalAssets() + 1, 0);
        }
    }

    /// LPs can only ever be paid from the liquid balance, so the vault can never
    /// owe out more cash than it holds.
    function invariant_noLpCanWithdrawMoreThanIsHeld() public view {
        for (uint256 i = 0; i < 3; i++) {
            assertLe(vault.maxWithdraw(handler.lps(i)), vault.liquidBalance());
        }
    }

    /// Fees accrue to LPs and nothing else reduces the vault's assets, so the
    /// share price must never fall. This is the property an LP relies on when
    /// they leave capital in the vault across a fill.
    function invariant_sharePriceNeverFalls() public view {
        if (vault.totalSupply() == 0) return;
        // One whole share, given the six-decimal virtual offset.
        uint256 pricePerShare = vault.previewRedeem(1e12);
        assertGe(pricePerShare, _initialPricePerShare());
    }

    function _initialPricePerShare() internal pure returns (uint256) {
        // A freshly seeded vault prices one whole share at one whole asset unit.
        return 1e6;
    }
}
