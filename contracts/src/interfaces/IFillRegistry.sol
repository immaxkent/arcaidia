// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IFillRegistry
/// @notice What the settlement receiver needs to know about the vault.
/// @dev Keeps `SettlementReceiver` independent of the vault's full surface: it
///      asks whether an intent was fast-filled, and hands back canonical funds
///      when it was.
interface IFillRegistry {
    /// @notice Whether LP capital was advanced for this intent.
    function isFilled(bytes32 intentId) external view returns (bool);

    /// @notice Principal advanced for this intent, zero if it was never filled.
    function advancedPrincipal(bytes32 intentId) external view returns (uint256);

    /// @notice Return canonical funds and clear the receivable.
    /// @dev Pulls `amount` from the caller, so the caller approves first.
    function recordReimbursement(bytes32 intentId, uint256 amount) external;
}
