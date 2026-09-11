// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISettlementCheck} from "./interfaces/ISettlementCheck.sol";

/// @title ArcaidiaIntentMarket
/// @notice The on-chain arbitrator that lets many independently-owned, independently-funded
///         vaults compete for the same intent — first-valid-fill, no auction clock, no window
///         for a losing bid to be front-run into a winning one.
/// @dev The market never holds money. It has exactly one piece of real state (`filledBy`) and
///      one job: decide, atomically, which vault — if any — gets to advance capital for a given
///      intent. Everything about *how much* to advance and *whether the caller is allowed to*
///      remains the calling vault's own business, checked entirely inside that vault's own
///      `fastFill`, both before and after this call.
///
///      **Why `filledBy` is an address, not a bool.** A bool answers "has anyone already won
///      this" but not "which vault won it" — and `SettlementReceiver` needs the second answer,
///      not the first, to know who to reimburse once many vaults can compete. `address(0)` means
///      unclaimed; any other value is the winning vault.
///
///      **Why this constructor takes one `ISettlementCheck`, not a registry of them.** V1 pairs
///      exactly one `SettlementReceiver` with one vault per chain, and this market is built
///      against that same shape for now: one settlement source of truth per chain. A future
///      where independently-deployed vaults each bring their own `SettlementReceiver` is not
///      resolved here — flagging it rather than guessing at a design nobody has specified yet.
///
///      **Why the fee ceiling is a fixed constant here, not each vault's own `maxFeeBps`.**
///      A vault's own ceiling is owner-configurable — nothing stops a careless or adversarial
///      third-party vault owner setting theirs far above what a user would reasonably expect.
///      This constant is the actual, protocol-wide worst case every user is guaranteed regardless
///      of which vault happens to win. It is deliberately not derived from the intent's own
///      user-specified `maxFeeBps` — see `WP-INTENT-MARKET.md` §6 for why that data can't be
///      verified against ground truth on this chain, and why a flat ceiling is the correct
///      substitute once first-valid-fill is the selection mechanism: price isn't a winning
///      factor under it, so a rational vault always charges the ceiling, and a user's own lower
///      preference is already protected off-chain, before any agent signs a fill that violates it.
contract ArcaidiaIntentMarket {
    /// @notice The hard ceiling every claim must respect, in bps of `outputAmount + feeAmount`.
    ///         Not owner-configurable, not per-vault — the one number every user can rely on
    ///         regardless of which vault wins.
    uint16 public constant MAX_FEE_BPS = 50; // 0.50%

    uint16 internal constant BPS_DENOMINATOR = 10_000;

    /// @notice `address(0)` = unclaimed; otherwise the vault that won this intent.
    mapping(bytes32 => address) public filledBy;

    /// @notice Where canonical settlement is checked before a claim is allowed.
    ISettlementCheck public immutable settlementCheck;

    event IntentClaimed(
        bytes32 indexed intentId, address indexed vault, uint256 outputAmount, uint256 feeAmount
    );

    error IntentAlreadyClaimed(bytes32 intentId, address claimedBy);
    error IntentAlreadySettledCanonically(bytes32 intentId);
    error FeeAboveUniversalCeiling(uint256 feeAmount, uint256 ceiling);

    constructor(ISettlementCheck settlementCheck_) {
        settlementCheck = settlementCheck_;
    }

    /// @notice Claim `intentId` for `msg.sender`. Reverts if anyone already won it, if canonical
    ///         settlement already paid it out via the no-solver fallback path, or if the fee
    ///         exceeds `MAX_FEE_BPS` of the total amount — regardless of what the calling vault's
    ///         own configured ceiling would otherwise allow.
    function claimIntent(bytes32 intentId, uint256 outputAmount, uint256 feeAmount) external {
        address existing = filledBy[intentId];
        if (existing != address(0)) revert IntentAlreadyClaimed(intentId, existing);

        if (settlementCheck.isSettled(intentId)) {
            revert IntentAlreadySettledCanonically(intentId);
        }

        uint256 ceiling = ((outputAmount + feeAmount) * MAX_FEE_BPS) / BPS_DENOMINATOR;
        if (feeAmount > ceiling) revert FeeAboveUniversalCeiling(feeAmount, ceiling);

        filledBy[intentId] = msg.sender;

        emit IntentClaimed(intentId, msg.sender, outputAmount, feeAmount);
    }
}
