// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {VaultHarness} from "./VaultHarness.sol";
import {MockUSDC} from "../../src/mocks/MockUSDC.sol";
import {FillAuthorization} from "../../src/libraries/ArcaidiaTypes.sol";

/// @notice Drives the vault through random but legal sequences of LP deposits,
///         redemptions, fast fills and canonical reimbursements.
///
/// @dev The unit tests check one transition at a time. This exists because the
///      dangerous states are combinations — an LP redeeming between a fill and
///      its reimbursement, a second fill landing while the first is still
///      outstanding, reimbursements arriving out of order. Foundry drives the
///      sequence; the invariants in `VaultInvariants.t.sol` assert what must
///      hold no matter which one it picks.
///
///      Ghost variables track what *should* be true independently of the
///      vault's own accounting, so the invariants compare two sources rather
///      than reading the vault twice.
contract VaultInvariantHandler is Test {
    VaultHarness public immutable vault;
    MockUSDC public immutable asset;

    uint256 internal immutable agentKey;
    address public immutable agent;

    address[3] public lps;
    address public constant RECIPIENT = address(0xBEEF);

    // --- ghosts -----------------------------------------------------------
    uint256 public ghostAdvanced;
    uint256 public ghostReimbursedPrincipal;
    uint256 public ghostFeesRealised;
    uint256 public ghostDeposited;
    uint256 public ghostRedeemed;
    uint256 public ghostFeesSwept;

    bytes32[] public filledIntents;
    mapping(bytes32 => bool) public reimbursed;

    uint256 internal nonceCounter;

    constructor(VaultHarness vault_, MockUSDC asset_, uint256 agentKey_) {
        vault = vault_;
        asset = asset_;
        agentKey = agentKey_;
        agent = vm.addr(agentKey_);

        lps = [makeAddr("invLpA"), makeAddr("invLpB"), makeAddr("invLpC")];
        for (uint256 i = 0; i < lps.length; i++) {
            asset.mint(lps[i], 1_000_000e6);
            vm.prank(lps[i]);
            asset.approve(address(vault), type(uint256).max);
        }
    }

    function _lp(uint256 seed) internal view returns (address) {
        return lps[seed % lps.length];
    }

    // --- actions ----------------------------------------------------------

    function deposit(uint256 lpSeed, uint256 amount) external {
        address lp = _lp(lpSeed);
        amount = bound(amount, 1e6, 200_000e6);
        if (asset.balanceOf(lp) < amount) return;

        vm.prank(lp);
        try vault.deposit(amount, lp) {
            ghostDeposited += amount;
        } catch {}
    }

    function redeem(uint256 lpSeed, uint256 sharesSeed) external {
        address lp = _lp(lpSeed);
        uint256 maxShares = vault.maxRedeem(lp);
        if (maxShares == 0) return;

        uint256 shares = bound(sharesSeed, 1, maxShares);
        vm.prank(lp);
        try vault.redeem(shares, lp, lp) returns (uint256 assets) {
            ghostRedeemed += assets;
        } catch {}
    }

    /// @dev Builds and signs a legal authorization, then submits it. Illegal
    ///      ones are the unit suite's job; here the point is that *legal*
    ///      sequences never break an invariant.
    function fastFill(uint256 amountSeed, uint256 feeSeed) external {
        uint256 available = vault.availableLiquidity();
        uint256 cap = vault.maxFillAmount();
        uint256 ceiling = available < cap ? available : cap;
        if (ceiling < 2) return;

        uint256 output = bound(amountSeed, 1, ceiling);
        uint256 fee = bound(feeSeed, 0, (output * vault.maxFeeBps()) / 10_000);
        uint256 input = output + fee;

        nonceCounter++;
        FillAuthorization memory auth = FillAuthorization({
            intentId: keccak256(abi.encode("inv-intent", nonceCounter)),
            sourceChainId: block.chainid == 11155111 ? 5042002 : 11155111,
            sourceTxHash: keccak256(abi.encode("inv-tx", nonceCounter)),
            recipient: RECIPIENT,
            inputAmount: input,
            outputAmount: output,
            feeAmount: fee,
            expiry: uint64(block.timestamp + 60),
            nonce: nonceCounter
        });

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(agentKey, vault.hashFillAuthorization(auth));

        try vault.fastFill(auth, abi.encodePacked(r, s, v)) {
            ghostAdvanced += output;
            filledIntents.push(auth.intentId);
        } catch {}
    }

    /// @dev Canonical settlement returns the input amount: principal plus fee.
    function reimburse(uint256 indexSeed) external {
        if (filledIntents.length == 0) return;

        bytes32 intentId = filledIntents[indexSeed % filledIntents.length];
        if (reimbursed[intentId]) return;

        uint256 principal = vault.advancedPrincipal(intentId);
        if (principal == 0) return;

        // The fee the agent quoted, recovered from the recorded principal.
        uint256 fee = (principal * vault.maxFeeBps()) / 10_000;
        uint256 canonical = principal + fee;

        asset.mint(address(this), canonical);
        asset.approve(address(vault), canonical);

        try vault.recordReimbursement(intentId, canonical) {
            reimbursed[intentId] = true;
            ghostReimbursedPrincipal += principal;
            ghostFeesRealised += fee;
        } catch {}
    }

    /// @dev The owner sweeping fees must never disturb LP accounting, so it
    ///      belongs in the random action set rather than in a separate test.
    function sweepFees(uint256) external {
        vm.prank(vault.owner());
        try vault.withdrawFees() returns (uint256 amount) {
            ghostFeesSwept += amount;
        } catch {}
    }

    /// @dev Advancing time exercises expiry without making fills impossible.
    function warp(uint256 seconds_) external {
        vm.warp(block.timestamp + bound(seconds_, 1, 30));
    }

    function filledIntentCount() external view returns (uint256) {
        return filledIntents.length;
    }

    /// @notice Principal advanced and not yet reimbursed, tracked independently
    ///         of the vault's own `outstandingExposure`.
    function ghostOutstanding() external view returns (uint256) {
        return ghostAdvanced - ghostReimbursedPrincipal;
    }
}
