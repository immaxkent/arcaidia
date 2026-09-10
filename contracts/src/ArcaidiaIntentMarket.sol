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
contract ArcaidiaIntentMarket {
    /// @notice `address(0)` = unclaimed; otherwise the vault that won this intent.
    mapping(bytes32 => address) public filledBy;

    /// @notice Where canonical settlement is checked before a claim is allowed.
    ISettlementCheck public immutable settlementCheck;

    event IntentClaimed(
        bytes32 indexed intentId, address indexed vault, uint256 outputAmount, uint256 feeAmount
    );

    error IntentAlreadyClaimed(bytes32 intentId, address claimedBy);
    error IntentAlreadySettledCanonically(bytes32 intentId);

    constructor(ISettlementCheck settlementCheck_) {
        settlementCheck = settlementCheck_;
    }

    /// @notice Claim `intentId` for `msg.sender`. Reverts if anyone already won it, or if
    ///         canonical settlement already paid it out via the no-solver fallback path.
    /// @dev `outputAmount`/`feeAmount` are recorded in the emitted event for off-chain observers;
    ///      the market does not itself validate them against the intent's own stated ceiling —
    ///      see WP-15's own notes on why that check cannot yet be made against ground truth on
    ///      this chain, and is deferred to whichever vault calls in, exactly as it is today.
    function claimIntent(bytes32 intentId, uint256 outputAmount, uint256 feeAmount) external {
        address existing = filledBy[intentId];
        if (existing != address(0)) revert IntentAlreadyClaimed(intentId, existing);

        if (settlementCheck.isSettled(intentId)) {
            revert IntentAlreadySettledCanonically(intentId);
        }

        filledBy[intentId] = msg.sender;

        emit IntentClaimed(intentId, msg.sender, outputAmount, feeAmount);
    }
}
