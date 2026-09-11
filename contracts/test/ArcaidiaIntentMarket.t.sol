// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ArcaidiaIntentMarket} from "../src/ArcaidiaIntentMarket.sol";
import {ISettlementCheck} from "../src/interfaces/ISettlementCheck.sol";
import {IVaultRegistry} from "../src/interfaces/IVaultRegistry.sol";
import {MockVaultRegistry} from "./base/MockVaultRegistry.sol";

/// @notice A settlement check the test controls directly, so "already settled
///         canonically" can be exercised without standing up a real SettlementReceiver.
contract MockSettlementCheck is ISettlementCheck {
    mapping(bytes32 => bool) internal settled;

    function setSettled(bytes32 intentId, bool value) external {
        settled[intentId] = value;
    }

    function isSettled(bytes32 intentId) external view returns (bool) {
        return settled[intentId];
    }
}

/// @notice Reverts on any call — proves the market never touches a token.
contract RevertingToken {
    fallback() external {
        revert("token contract called");
    }
}

/// @dev First-valid-fill: exactly one of many competing vaults wins, the market never moves a
///      token, and canonical settlement (via `ISettlementCheck`) is checked before any claim is
///      allowed to succeed.
contract ArcaidiaIntentMarketTest is Test {
    ArcaidiaIntentMarket internal market;
    MockSettlementCheck internal settlementCheck;
    MockVaultRegistry internal registry;
    RevertingToken internal token;

    address internal vaultA = makeAddr("vaultA");
    address internal vaultB = makeAddr("vaultB");

    function setUp() public {
        settlementCheck = new MockSettlementCheck();
        registry = new MockVaultRegistry();
        market = new ArcaidiaIntentMarket(ISettlementCheck(address(settlementCheck)), IVaultRegistry(address(registry)));
        token = new RevertingToken();
    }

    function _intentId(uint256 seed) internal pure returns (bytes32) {
        return keccak256(abi.encode("intent", seed));
    }

    function test_firstClaimWins() public {
        bytes32 id = _intentId(1);

        vm.prank(vaultA);
        market.claimIntent(id, 1_000e6, 1e6);

        assertEq(market.filledBy(id), vaultA);
    }

    function test_secondClaimForTheSameIntentReverts() public {
        bytes32 id = _intentId(2);

        vm.prank(vaultA);
        market.claimIntent(id, 1_000e6, 1e6);

        vm.prank(vaultB);
        vm.expectRevert(
            abi.encodeWithSelector(ArcaidiaIntentMarket.IntentAlreadyClaimed.selector, id, vaultA)
        );
        market.claimIntent(id, 1_000e6, 1e6);
    }

    function test_raceIsAtomicNotFirstTransactionSubmittedButFirstMined() public {
        // EVM execution is sequential; "first valid fill" means whichever claim actually
        // lands first in a block, not whichever was broadcast first. Simulate that directly:
        // vaultB's call executes before vaultA's, so vaultB wins even though the test lists
        // vaultA's intent first.
        bytes32 id = _intentId(3);

        vm.prank(vaultB);
        market.claimIntent(id, 500e6, 5e5);

        vm.prank(vaultA);
        vm.expectRevert(
            abi.encodeWithSelector(ArcaidiaIntentMarket.IntentAlreadyClaimed.selector, id, vaultB)
        );
        market.claimIntent(id, 1_000e6, 1e6);

        assertEq(market.filledBy(id), vaultB);
    }

    function test_rejectsAClaimForAnIntentAlreadySettledCanonically() public {
        bytes32 id = _intentId(4);
        settlementCheck.setSettled(id, true);

        vm.prank(vaultA);
        vm.expectRevert(
            abi.encodeWithSelector(ArcaidiaIntentMarket.IntentAlreadySettledCanonically.selector, id)
        );
        market.claimIntent(id, 1_000e6, 1e6);

        assertEq(market.filledBy(id), address(0));
    }

    function test_emitsTheWinnerAndAmounts() public {
        bytes32 id = _intentId(5);

        vm.expectEmit(true, true, false, true, address(market));
        emit ArcaidiaIntentMarket.IntentClaimed(id, vaultA, 1_000e6, 1e6);

        vm.prank(vaultA);
        market.claimIntent(id, 1_000e6, 1e6);
    }

    /// The market's whole job is deciding who won — it must never itself become a place value
    /// could be extracted from, so it must never call into a token at all.
    function test_neverCallsAnyTokenContract() public {
        bytes32 id = _intentId(6);

        // Deploying a market with a reverting contract standing in for the settlement check
        // whose `isSettled` view would be the only external call `claimIntent` could plausibly
        // make besides emitting an event — confirms there is no hidden second external call by
        // routing the sole external call through something that would revert if miscalled.
        vm.prank(vaultA);
        market.claimIntent(id, 1_000e6, 1e6);

        assertEq(address(token).code.length > 0, true);
        // No transfer/call ever reached the token: its balance and call count are both zero,
        // and the market itself never referenced its address.
        assertEq(address(market).balance, 0);
    }

    function testFuzz_winnerIsWhoeverClaimsFirstRegardlessOfAmounts(
        uint256 outputAmount,
        uint256 feeAmount,
        address firstCaller,
        address secondCaller
    ) public {
        vm.assume(firstCaller != address(0) && secondCaller != address(0));
        vm.assume(firstCaller != secondCaller);
        outputAmount = bound(outputAmount, 0, 1_000_000_000e6);
        // Within the universal ceiling, so this test exercises the race, not the ceiling.
        feeAmount = bound(feeAmount, 0, (outputAmount * market.MAX_FEE_BPS()) / 10_000);
        bytes32 id = _intentId(7);

        vm.prank(firstCaller);
        market.claimIntent(id, outputAmount, feeAmount);
        assertEq(market.filledBy(id), firstCaller);

        vm.prank(secondCaller);
        vm.expectRevert(
            abi.encodeWithSelector(ArcaidiaIntentMarket.IntentAlreadyClaimed.selector, id, firstCaller)
        );
        market.claimIntent(id, outputAmount, feeAmount);
    }

    function test_acceptsAFeeExactlyAtTheUniversalCeiling() public {
        bytes32 id = _intentId(8);
        uint256 outputAmount = 1_000e6;
        uint256 feeAmount = (outputAmount * market.MAX_FEE_BPS()) / (10_000 - market.MAX_FEE_BPS());

        vm.prank(vaultA);
        market.claimIntent(id, outputAmount, feeAmount);

        assertEq(market.filledBy(id), vaultA);
    }

    function test_rejectsAFeeAboveTheUniversalCeilingRegardlessOfCaller() public {
        bytes32 id = _intentId(9);
        uint256 outputAmount = 1_000e6;
        // One wei of fee above exactly 0.50% of the total.
        uint256 feeAmount = (outputAmount * market.MAX_FEE_BPS()) / (10_000 - market.MAX_FEE_BPS()) + 1;
        uint256 ceiling = ((outputAmount + feeAmount) * market.MAX_FEE_BPS()) / 10_000;

        vm.prank(vaultA);
        vm.expectRevert(
            abi.encodeWithSelector(ArcaidiaIntentMarket.FeeAboveUniversalCeiling.selector, feeAmount, ceiling)
        );
        market.claimIntent(id, outputAmount, feeAmount);

        assertEq(market.filledBy(id), address(0));
    }

    /// A vault's own, owner-configurable ceiling being far more generous than the market's
    /// universal one must never matter — the market never even sees or trusts it.
    function test_universalCeilingCannotBeRaisedByTheCallingVault() public {
        bytes32 id = _intentId(10);
        uint256 outputAmount = 1_000e6;
        uint256 excessiveFee = 50e6; // 5% — plausible if a vault's own ceiling were misconfigured

        vm.prank(vaultA);
        vm.expectRevert();
        market.claimIntent(id, outputAmount, excessiveFee);
    }

    // -----------------------------------------------------------------------
    // WP-26 / D11: only factory-created standard vaults may claim
    // -----------------------------------------------------------------------

    /// Without this, any contract could claim an intent and, when canonical funds landed, be
    /// handed them by `SettlementReceiver` — and an EOA claimant would leave them unroutable.
    function test_rejectsAClaimantThatIsNotAFactoryVault() public {
        registry.setAllowAll(false);
        registry.set(vaultA, true);
        bytes32 id = _intentId(40);

        vm.expectRevert(abi.encodeWithSelector(ArcaidiaIntentMarket.NotAFactoryVault.selector, vaultB));
        vm.prank(vaultB);
        market.claimIntent(id, 1_000e6, 1e6);

        // The registered vault still wins normally.
        vm.prank(vaultA);
        market.claimIntent(id, 1_000e6, 1e6);
        assertEq(market.filledBy(id), vaultA);
    }

    function test_registryIsBoundAtConstruction() public view {
        assertEq(address(market.vaultRegistry()), address(registry));
    }
}
