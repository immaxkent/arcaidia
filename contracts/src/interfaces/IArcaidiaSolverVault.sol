// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {FillAuthorization, Intent} from "../libraries/ArcaidiaTypes.sol";

/// @title IArcaidiaSolverVault
/// @notice The uniform surface any conforming vault exposes so the intent market and off-chain
///         tooling can treat a third-party deployment identically to the House Vault.
/// @dev The comparison worth keeping in mind is ERC-4626 itself: one interface, permissionless
///      deployment, integrators compose against any conforming vault — fitting, since
///      `ArcaidiaLiquidityVault` already is one.
///
///      v1.1 (WP-24): the vault is handed the canonical `Intent` itself, both to quote and to
///      fill. It recomputes `intentId` from it and binds every enforced term — the user's
///      `maxFeeBps` above all — to the id the signed authorization, the market claim and the
///      CCTP hook all share (DECISIONS.md D6). `FillAuthorization` is byte-identical to v1.
interface IArcaidiaSolverVault {
    /// @notice What this vault would charge to fill `intent` right now, and whether it could.
    /// @dev A view call — no state change, no commitment. `feeBps` is the vault's own posted
    ///      tier at current utilisation (D7); `canFill` is false when the fee exceeds the user's
    ///      `maxFeeBps`, the amount breaches a cap, liquidity is short, or the vault is paused.
    function quote(Intent calldata intent)
        external
        view
        returns (uint16 feeBps, uint256 feeAmount, uint256 outputAmount, bool canFill);

    /// @notice Execute a signed, verified fill of `intent`.
    function fastFill(Intent calldata intent, FillAuthorization calldata authorization, bytes calldata signature)
        external
        returns (address signer);
}
