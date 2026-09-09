// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title ISettlementCheck
/// @notice What the vault needs to know about the settlement receiver.
/// @dev The mirror of `IFillRegistry`: that interface is what `SettlementReceiver`
///      uses to ask the vault "was this fast-filled"; this is what the vault uses
///      to ask `SettlementReceiver` "has this already been settled canonically."
///
///      Without this check, an intent that nobody fast-filled and that
///      `SettlementReceiver.settle()` already paid out via its fallback branch
///      remains, as far as the vault's own `intentFilled` mapping is concerned,
///      indistinguishable from an intent nobody has touched at all — because
///      the fallback branch never calls the vault. A late `fastFill()` for that
///      same intent would pay the recipient a second time, entirely out of LP
///      capital, with no canonical mint ever backing it. This interface closes
///      that gap: the vault checks it before paying out, exactly as
///      `SettlementReceiver` already checks `IFillRegistry.isFilled` before
///      choosing its own branch. Neither side writes into the other; each only
///      reads the other's already-committed state, which is enough because EVM
///      execution is sequential — whichever transaction lands first is fully
///      visible to the second.
interface ISettlementCheck {
    /// @notice Whether canonical settlement has already been recorded for this intent.
    function isSettled(bytes32 intentId) external view returns (bool);
}
