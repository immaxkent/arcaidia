// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ChainFixture} from "./base/ChainFixture.sol";
import {NeverSettledCheck} from "./base/VaultFixture.sol";
import {VaultHarness} from "./harness/VaultHarness.sol";
import {ReentrantToken} from "../src/mocks/ReentrantToken.sol";
import {ArcaidiaLiquidityVault} from "../src/ArcaidiaLiquidityVault.sol";
import {ArcaidiaIntentMarket} from "../src/ArcaidiaIntentMarket.sol";
import {ISettlementCheck} from "../src/interfaces/ISettlementCheck.sol";
import {FillAuthorization, Intent, INTENT_VERSION, USDC_TOKEN_OUT} from "../src/libraries/ArcaidiaTypes.sol";
import {IntentLib} from "../src/libraries/IntentLib.sol";
import {IVaultRegistry} from "../src/interfaces/IVaultRegistry.sol";
import {MockVaultRegistry} from "./base/MockVaultRegistry.sol";
import {TestPolicies} from "./base/TestPolicies.sol";

/// @notice The vault against a hostile settlement asset.
/// @dev Real USDC has no transfer hook. But the vault holds a configured IERC20
///      and V2 widens the asset set, so a vault that is only safe because the
///      token is well-behaved is a vault waiting for the first token that is not.
contract VaultReentrancyTest is ChainFixture {
    ReentrantToken internal asset;
    VaultHarness internal vault;

    address internal vaultOwner = makeAddr("owner");
    address internal lp = makeAddr("lp");
    address internal recipient = makeAddr("recipient");

    uint256 internal agentKey;
    address internal agent;

    function setUp() public {
        _configureDirection();
        vm.chainId(destinationChainId);

        asset = new ReentrantToken();
        vault = new VaultHarness();
        vault.initialize(vaultOwner, address(asset), 1_000, 2_500, 10_000, TestPolicies.permissive());

        (agent, agentKey) = makeAddrAndKey("agent");
        vm.startPrank(vaultOwner);
        vault.setMarket(
            address(
                new ArcaidiaIntentMarket(
                    ISettlementCheck(address(new NeverSettledCheck())), IVaultRegistry(address(new MockVaultRegistry()))
                )
            )
        );
        vault.setAuthorisedSigner(agent, true);
        vault.setSettlementReceiver(address(this));
        vm.stopPrank();

        asset.mint(lp, 500_000e6);
        vm.prank(lp);
        asset.approve(address(vault), type(uint256).max);
        vm.prank(lp);
        vault.deposit(100_000e6, lp);
    }

    /// Stands in as `settlementReceiver` (set above) so this contract can call
    /// `recordReimbursement` directly. `fastFill` now checks `isSettled` before
    /// paying out (WP-10 hardening); these tests are all about fast-fill and
    /// reimbursement mechanics, never about a canonical-settlement race, so
    /// "never settled" is the correct constant answer here.
    function isSettled(bytes32) external pure returns (bool) {
        return false;
    }

    mapping(bytes32 => Intent) internal intents;

    function _intentOf(FillAuthorization memory auth) internal view returns (Intent memory) {
        return intents[auth.intentId];
    }

    function _authorization(uint256 nonce, uint256 input, uint256 fee)
        internal
        returns (FillAuthorization memory)
    {
        Intent memory intent = Intent({
            intentVersion: INTENT_VERSION,
            sender: lp,
            recipient: recipient,
            inputToken: address(asset),
            amount: input,
            sourceChainId: sourceChainId,
            destinationChainId: block.chainid,
            maxFeeBps: 100,
            deadline: uint64(block.timestamp + 1 hours),
            nonce: nonce,
            tokenOut: USDC_TOKEN_OUT,
            targetMinOut: 0
        });
        bytes32 intentId = IntentLib.computeIntentId(intent);
        intents[intentId] = intent;
        return FillAuthorization({
            intentId: intentId,
            sourceChainId: sourceChainId,
            sourceTxHash: keccak256(abi.encode("tx", nonce)),
            recipient: recipient,
            inputAmount: input,
            outputAmount: input - fee,
            feeAmount: fee,
            expiry: uint64(block.timestamp + 60),
            nonce: nonce
        });
    }

    function _sign(FillAuthorization memory auth) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(agentKey, vault.hashFillAuthorization(auth));
        return abi.encodePacked(r, s, v);
    }

    // -----------------------------------------------------------------------
    // Reentry during a fast fill
    // -----------------------------------------------------------------------

    /// The token calls back while the vault is paying the recipient. The same
    /// intent must not be fillable a second time.
    function test_reentrantFillCannotSpendTheSameIntentTwice() public {
        FillAuthorization memory auth = _authorization(1, 10_000e6, 50e6);
        bytes memory signature = _sign(auth);

        asset.arm(address(vault), abi.encodeCall(ArcaidiaLiquidityVault.fastFill, (_intentOf(auth), auth, signature)));

        vault.fastFill(_intentOf(auth), auth, signature);

        assertEq(asset.callbackCount(), 1, "callback did not fire; the test proves nothing");
        assertFalse(asset.lastCallSucceeded(), "reentrant fill must fail");
        assertEq(asset.balanceOf(recipient), 9_950e6, "recipient paid exactly once");
        assertEq(vault.outstandingExposure(), 9_950e6, "exposure counted once");
    }

    /// A different intent reentering mid-transfer must also fail, so the guard
    /// holds regardless of whether replay protection would have caught it.
    function test_reentrantFillOfADifferentIntentIsBlocked() public {
        FillAuthorization memory first = _authorization(2, 10_000e6, 50e6);
        FillAuthorization memory second = _authorization(3, 5_000e6, 25e6);
        bytes memory secondSignature = _sign(second);

        asset.arm(address(vault), abi.encodeCall(ArcaidiaLiquidityVault.fastFill, (_intentOf(second), second, secondSignature)));

        vault.fastFill(_intentOf(first), first, _sign(first));

        assertEq(asset.callbackCount(), 1);
        assertFalse(asset.lastCallSucceeded(), "a nested fill must be blocked by the guard");
        assertFalse(vault.isFilled(second.intentId), "the nested intent must not be recorded");
        assertEq(vault.outstandingExposure(), 9_950e6, "only the outer fill counted");
    }

    /// Redeeming mid-fill would price the LP against a half-updated vault.
    function test_reentrantRedeemDuringAFillIsBlocked() public {
        uint256 shares = vault.balanceOf(lp);
        asset.arm(address(vault), abi.encodeCall(ArcaidiaLiquidityVault.redeem, (shares, lp, lp)));

        FillAuthorization memory auth = _authorization(4, 10_000e6, 50e6);
        vault.fastFill(_intentOf(auth), auth, _sign(auth));

        assertEq(asset.callbackCount(), 1);
        assertFalse(asset.lastCallSucceeded(), "redeem during a fill must be blocked");
        assertEq(vault.balanceOf(lp), shares, "no shares were burned");
    }

    // -----------------------------------------------------------------------
    // Reentry during LP operations
    // -----------------------------------------------------------------------

    function test_reentrantDepositDuringARedeemIsBlocked() public {
        vm.prank(lp);
        asset.arm(address(vault), abi.encodeCall(ArcaidiaLiquidityVault.deposit, (1_000e6, lp)));

        uint256 supplyBefore = vault.totalSupply();
        vm.prank(lp);
        vault.redeem(1_000e12, lp, lp);

        assertEq(asset.callbackCount(), 1);
        assertFalse(asset.lastCallSucceeded(), "deposit during a redeem must be blocked");
        assertLt(vault.totalSupply(), supplyBefore, "the outer redeem still completed");
    }

    function test_reentrantRedeemDuringADepositIsBlocked() public {
        uint256 shares = vault.balanceOf(lp);
        vm.prank(lp);
        asset.arm(address(vault), abi.encodeCall(ArcaidiaLiquidityVault.redeem, (shares, lp, lp)));

        vm.prank(lp);
        vault.deposit(1_000e6, lp);

        assertEq(asset.callbackCount(), 1);
        assertFalse(asset.lastCallSucceeded(), "redeem during a deposit must be blocked");
    }

    // -----------------------------------------------------------------------
    // Reentry during reimbursement
    // -----------------------------------------------------------------------

    function test_reentrantReimbursementIsBlocked() public {
        FillAuthorization memory auth = _authorization(5, 10_000e6, 50e6);
        vault.fastFill(_intentOf(auth), auth, _sign(auth));

        asset.mint(address(this), 20_000e6);
        asset.approve(address(vault), type(uint256).max);

        asset.arm(
            address(vault),
            abi.encodeCall(ArcaidiaLiquidityVault.recordReimbursement, (auth.intentId, 10_000e6))
        );

        vault.recordReimbursement(auth.intentId, 10_000e6);

        assertEq(asset.callbackCount(), 1);
        assertFalse(asset.lastCallSucceeded(), "nested reimbursement must be blocked");
        assertEq(vault.outstandingExposure(), 0, "the receivable cleared exactly once");
        assertEq(vault.advancedPrincipal(auth.intentId), 0);
    }

    // -----------------------------------------------------------------------
    // Sanity: the adversary works
    // -----------------------------------------------------------------------

    /// If the callback never fired, every test above would pass vacuously.
    function test_theCallbackActuallyFires() public {
        asset.arm(address(this), abi.encodeWithSignature("nonexistentFunction()"));

        vm.prank(lp);
        vault.deposit(1_000e6, lp);

        assertEq(asset.callbackCount(), 1, "the hostile token never called back");
    }
}
