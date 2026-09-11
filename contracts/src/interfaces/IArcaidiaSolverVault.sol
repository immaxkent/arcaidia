// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {FillAuthorization, IntentOpportunity} from "../libraries/ArcaidiaTypes.sol";

/// @title IArcaidiaSolverVault
/// @notice The uniform surface any conforming vault exposes so the intent market and off-chain
///         tooling can treat a third-party deployment identically to the House Vault.
/// @dev The comparison worth keeping in mind is ERC-4626 itself: one interface, permissionless
///      deployment, integrators compose against any conforming vault — fitting, since
///      `ArcaidiaLiquidityVault` already is one. This interface adds nothing beyond what a vault
///      already does; it exists so a solver or the market can call an arbitrary vault without
///      knowing its concrete type.
interface IArcaidiaSolverVault {
    /// @notice What this vault would charge to fill `opportunity` right now, given its own live
    ///         liquidity, exposure and caps.
    /// @dev A view call — no state change, no commitment. `opportunity` is constructed off-chain
    ///      by the caller from whatever it already trusts as the real `Intent`; nothing on-chain
    ///      stores it (see `IntentOpportunity`'s own doc comment).
    function quote(IntentOpportunity calldata opportunity)
        external
        view
        returns (uint256 outputAmount, uint256 feeAmount);

    /// @notice Execute a signed, verified fill. Unchanged in shape from V1 — the market call this
    ///         phase adds lives *inside* the implementation, not in this external signature.
    function fastFill(FillAuthorization calldata authorization, bytes calldata signature)
        external
        returns (address signer);
}
