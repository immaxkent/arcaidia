// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IIntentMarket
/// @notice What the vault and the settlement receiver each need from `ArcaidiaIntentMarket` —
///         bundled the same way `IFillRegistry` bundles everything `SettlementReceiver` needs
///         from a vault, rather than one interface per caller for the same contract.
interface IIntentMarket {
    /// @notice Claim `intentId` for `msg.sender`. Reverts if already claimed, if canonical
    ///         settlement already paid it out, or if `feeAmount` exceeds the market's universal
    ///         ceiling. Called by a vault, from inside its own `fastFill`.
    function claimIntent(bytes32 intentId, uint256 outputAmount, uint256 feeAmount) external;

    /// @notice `address(0)` if unclaimed; otherwise the vault that won this intent. Called by
    ///         `SettlementReceiver` to learn who to reimburse — the market, not any one vault,
    ///         is now the source of truth for "who won."
    function filledBy(bytes32 intentId) external view returns (address);
}
