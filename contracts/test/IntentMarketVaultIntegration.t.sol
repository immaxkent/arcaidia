// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ChainFixture} from "./base/ChainFixture.sol";
import {NeverSettledCheck} from "./base/VaultFixture.sol";
import {VaultHarness} from "./harness/VaultHarness.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {ArcaidiaIntentMarket} from "../src/ArcaidiaIntentMarket.sol";
import {SettlementReceiver} from "../src/SettlementReceiver.sol";
import {ISettlementCheck} from "../src/interfaces/ISettlementCheck.sol";
import {FillAuthorization, Intent, INTENT_VERSION, USDC_TOKEN_OUT} from "../src/libraries/ArcaidiaTypes.sol";
import {IntentLib} from "../src/libraries/IntentLib.sol";
import {IVaultRegistry} from "../src/interfaces/IVaultRegistry.sol";
import {MockVaultRegistry} from "./base/MockVaultRegistry.sol";
import {TestPolicies} from "./base/TestPolicies.sol";
import {MockMessageTransmitterV2} from "../src/mocks/MockMessageTransmitterV2.sol";

/// @notice WP-16's actual acceptance gate: two independently-deployed, independently-funded
///         vaults, sharing nothing but the market and the settlement asset, racing for the
///         same intent through real `ArcaidiaLiquidityVault.fastFill` calls — not mocks.
contract IntentMarketVaultIntegrationTest is ChainFixture {
    MockUSDC internal asset;
    ArcaidiaIntentMarket internal market;
    MockVaultRegistry internal registry;
    mapping(bytes32 => Intent) internal intents;

    VaultHarness internal vaultA;
    VaultHarness internal vaultB;

    uint256 internal agentAKey;
    address internal agentA;
    uint256 internal agentBKey;
    address internal agentB;

    address internal recipient = makeAddr("recipient");

    function setUp() public {
        _configureDirection();
        vm.chainId(destinationChainId);

        asset = new MockUSDC();
        registry = new MockVaultRegistry();
        market = new ArcaidiaIntentMarket(
            ISettlementCheck(address(new NeverSettledCheck())), IVaultRegistry(address(registry))
        );

        vaultA = _standUpVault("vaultAOwner", "lpA", 100_000e6);
        vaultB = _standUpVault("vaultBOwner", "lpB", 100_000e6);

        (agentA, agentAKey) = makeAddrAndKey("agentA");
        (agentB, agentBKey) = makeAddrAndKey("agentB");

        vm.prank(_ownerOf(vaultA));
        vaultA.setAuthorisedSigner(agentA, true);
        vm.prank(_ownerOf(vaultB));
        vaultB.setAuthorisedSigner(agentB, true);
    }

    function _standUpVault(string memory ownerSeed, string memory lpSeed, uint256 deposit)
        internal
        returns (VaultHarness v)
    {
        address vOwner = makeAddr(ownerSeed);
        address lp = makeAddr(lpSeed);

        v = new VaultHarness();
        // 10% reserve floor, 50% fill cap, 80% exposure cap, permissive fee tiers
        v.initialize(vOwner, address(asset), 1_000, 5_000, 8_000, TestPolicies.permissive());

        vm.startPrank(vOwner);
        v.setMarket(address(market));
        vm.stopPrank();

        asset.mint(lp, deposit);
        vm.prank(lp);
        asset.approve(address(v), type(uint256).max);
        vm.prank(lp);
        v.deposit(deposit, lp);
    }

    // `VaultHarness`/`ArcaidiaLiquidityVault` expose `owner` as a public var, not a helper —
    // named indirection here only so `setUp` reads by role, not by re-deriving `makeAddr`.
    function _ownerOf(VaultHarness v) internal view returns (address) {
        return v.owner();
    }

    /// @dev A real intent (schema v1.1) seeded by `seed`, remembered under its canonical id so
    ///      each vault can be handed it alongside the authorization (D6).
    function _authorization(bytes32 seed, uint256 inputAmount, uint256 feeAmount)
        internal
        returns (FillAuthorization memory)
    {
        Intent memory intent = Intent({
            intentVersion: INTENT_VERSION,
            sender: makeAddr("sender"),
            recipient: recipient,
            inputToken: address(asset),
            amount: inputAmount,
            sourceChainId: sourceChainId,
            destinationChainId: block.chainid,
            maxFeeBps: 150,
            deadline: uint64(block.timestamp + 1 hours),
            nonce: uint256(seed),
            tokenOut: USDC_TOKEN_OUT,
            targetMinOut: 0
        });
        bytes32 intentId = IntentLib.computeIntentId(intent);
        intents[intentId] = intent;
        return FillAuthorization({
            intentId: intentId,
            sourceChainId: sourceChainId,
            sourceTxHash: keccak256(abi.encode("tx", intentId)),
            recipient: recipient,
            inputAmount: inputAmount,
            outputAmount: inputAmount - feeAmount,
            feeAmount: feeAmount,
            expiry: uint64(block.timestamp + 45),
            nonce: 1
        });
    }

    function _intentOf(FillAuthorization memory auth) internal view returns (Intent memory) {
        return intents[auth.intentId];
    }

    function _sign(VaultHarness v, FillAuthorization memory auth, uint256 key)
        internal
        view
        returns (bytes memory)
    {
        (uint8 vv, bytes32 r, bytes32 s) = vm.sign(key, v.hashFillAuthorization(auth));
        return abi.encodePacked(r, s, vv);
    }

    /// The core proof: both vaults are independently willing and able to fill the same intent
    /// (same fields, valid for either), but only one payout ever happens.
    function test_onlyOneOfTwoCompetingVaultsFillsTheSameIntent() public {
        bytes32 intentId = keccak256("shared-intent");
        FillAuthorization memory auth = _authorization(intentId, 10_000e6, 100e6);
        intentId = auth.intentId;

        address signerA = vaultA.fastFill(_intentOf(auth), auth, _sign(vaultA, auth, agentAKey));
        assertEq(signerA, agentA);
        assertEq(market.filledBy(intentId), address(vaultA));
        assertEq(asset.balanceOf(recipient), 9_900e6);

        // Signed *before* arming expectRevert — `_sign` itself makes an external view call, and
        // vm.expectRevert attaches to whichever call comes next, reverting or not.
        bytes memory sigB = _sign(vaultB, auth, agentBKey);
        vm.expectRevert(
            abi.encodeWithSelector(
                ArcaidiaIntentMarket.IntentAlreadyClaimed.selector, intentId, address(vaultA)
            )
        );
        vaultB.fastFill(_intentOf(auth), auth, sigB);

        // No second payout, and vaultB's own liquidity is untouched — it never advanced anything.
        assertEq(asset.balanceOf(recipient), 9_900e6);
        assertEq(vaultB.outstandingExposure(), 0);
    }

    /// Whichever vault's transaction is actually mined first wins — broadcast order never
    /// matters, only execution order, which is the whole point of first-valid-fill.
    function test_secondToExecuteLosesEvenIfConstructedFirst() public {
        bytes32 intentId = keccak256("execution-order-intent");
        FillAuthorization memory auth = _authorization(intentId, 5_000e6, 50e6);
        intentId = auth.intentId;
        bytes memory sigA = _sign(vaultA, auth, agentAKey);
        bytes memory sigB = _sign(vaultB, auth, agentBKey);

        // vaultB executes first even though vaultA's signature was produced first above.
        address signerB = vaultB.fastFill(_intentOf(auth), auth, sigB);
        assertEq(signerB, agentB);
        assertEq(market.filledBy(intentId), address(vaultB));

        vm.expectRevert(
            abi.encodeWithSelector(
                ArcaidiaIntentMarket.IntentAlreadyClaimed.selector, intentId, address(vaultB)
            )
        );
        vaultA.fastFill(_intentOf(auth), auth, sigA);
    }

    /// V1's single-vault behaviour must be unchanged: one vault, alone in the market,
    /// still fills exactly as it always did.
    function test_aLoneVaultInTheMarketFillsExactlyAsBefore() public {
        bytes32 intentId = keccak256("solo-intent");
        FillAuthorization memory auth = _authorization(intentId, 10_000e6, 100e6);
        intentId = auth.intentId;

        address signer = vaultA.fastFill(_intentOf(auth), auth, _sign(vaultA, auth, agentAKey));

        assertEq(signer, agentA);
        assertEq(asset.balanceOf(recipient), 9_900e6);
        assertEq(vaultA.outstandingExposure(), 9_900e6);
    }

    // -----------------------------------------------------------------------
    // WP-16.3: reimbursement follows the market's winner, not one fixed vault
    // -----------------------------------------------------------------------

    function _standUpReceiver() internal returns (SettlementReceiver receiver, address reporter) {
        address receiverOwner = makeAddr("receiverOwner");
        reporter = makeAddr("reporter");

        receiver = new SettlementReceiver();
        receiver.initialize(
            receiverOwner, address(asset), address(market), address(new MockMessageTransmitterV2(asset))
        );

        vm.prank(receiverOwner);
        receiver.setReporter(reporter, true);

        // Each vault only accepts reimbursement calls from its own configured receiver —
        // independent of which one the market itself happens to be paired with.
        vm.prank(_ownerOf(vaultA));
        vaultA.setSettlementReceiver(address(receiver));
        vm.prank(_ownerOf(vaultB));
        vaultB.setSettlementReceiver(address(receiver));
    }

    /// The core WP-16.3 proof: two vaults race, vaultB wins, and canonical settlement
    /// reimburses vaultB specifically — never vaultA, which never advanced anything.
    function test_settlementReimbursesWhicheverVaultActuallyWon() public {
        (SettlementReceiver receiver, address reporter) = _standUpReceiver();

        bytes32 intentId = keccak256("reimbursement-intent");
        FillAuthorization memory auth = _authorization(intentId, 10_000e6, 100e6);
        intentId = auth.intentId;

        address signer = vaultB.fastFill(_intentOf(auth), auth, _sign(vaultB, auth, agentBKey));
        assertEq(signer, agentB);
        assertEq(market.filledBy(intentId), address(vaultB));
        // Captured *after* the fill's own outflow (9,900e6 left for the recipient), so the
        // reimbursement's effect below is isolated to canonical settlement, not the fill itself.
        uint256 vaultBLiquidAfterFill = vaultB.liquidBalance();

        asset.mint(address(receiver), 10_000e6);
        vm.prank(reporter);
        SettlementReceiver.Outcome outcome = receiver.settle(intentId, recipient, 10_000e6);

        assertEq(uint256(outcome), uint256(SettlementReceiver.Outcome.LP_REIMBURSED));
        assertEq(
            vaultB.liquidBalance(), vaultBLiquidAfterFill + 10_000e6, "vaultB, the winner, is reimbursed"
        );
        assertEq(vaultB.outstandingExposure(), 0, "vaultB's receivable is cleared");
        // vaultA never advanced anything for this intent and must be completely untouched.
        assertEq(vaultA.outstandingExposure(), 0, "vaultA never participated in this intent");
    }

    /// The fallback invariant still holds with a market in the picture: nobody won,
    /// so settlement pays the recipient directly, and neither vault is touched.
    function test_unfilledIntentStillFallsBackWithAMarketWired() public {
        (SettlementReceiver receiver, address reporter) = _standUpReceiver();

        bytes32 intentId = keccak256("never-filled-intent");
        assertEq(market.filledBy(intentId), address(0));

        asset.mint(address(receiver), 10_000e6);
        vm.prank(reporter);
        SettlementReceiver.Outcome outcome = receiver.settle(intentId, recipient, 10_000e6);

        assertEq(uint256(outcome), uint256(SettlementReceiver.Outcome.RECIPIENT_FALLBACK));
        assertEq(asset.balanceOf(recipient), 10_000e6);
        assertEq(vaultA.outstandingExposure(), 0);
        assertEq(vaultB.outstandingExposure(), 0);
    }
}
