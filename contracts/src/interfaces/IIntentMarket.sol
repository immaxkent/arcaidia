// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IIntentMarket
/// @notice What a vault needs from `ArcaidiaIntentMarket` to claim an intent before paying it.
/// @dev Kept narrow, the same reason `IFillRegistry`/`ISettlementCheck` are: a vault depends on
///      this one function, not the market's full surface.
interface IIntentMarket {
    /// @notice Claim `intentId` for `msg.sender`. Reverts if already claimed, if canonical
    ///         settlement already paid it out, or if `feeAmount` exceeds the market's universal
    ///         ceiling.
    function claimIntent(bytes32 intentId, uint256 outputAmount, uint256 feeAmount) external;
}
