// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IVaultRegistry} from "../../src/interfaces/IVaultRegistry.sol";

/// @notice Stand-in for `ArcaidiaVaultFactory`'s registry role (D11). Allows every claimant by
///         default so suites that construct vaults directly (not through the factory) keep
///         working; `setAllowAll(false)` + `set(...)` model the real allowlist.
contract MockVaultRegistry is IVaultRegistry {
    bool public allowAll = true;
    mapping(address => bool) public allowed;

    function setAllowAll(bool value) external {
        allowAll = value;
    }

    function set(address vault, bool value) external {
        allowed[vault] = value;
    }

    function isFactoryVault(address vault) external view returns (bool) {
        return allowAll || allowed[vault];
    }
}
