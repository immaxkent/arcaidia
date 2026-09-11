// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IVaultRegistry
/// @notice What the market needs to know about a claimant: is it a vault created by the standard
///         factory? Implemented by `ArcaidiaVaultFactory` (DECISIONS.md D11).
interface IVaultRegistry {
    function isFactoryVault(address vault) external view returns (bool);
}
