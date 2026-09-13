// Vendored from immaxkent/uniswap-v2 (Arcaidia Line 1) at commit 30a494e — test support only, not deployed by this repository.
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @notice Canonical Uniswap V2 `Math` — unchanged but for the pragma.
library Math {
    function min(uint256 x, uint256 y) internal pure returns (uint256 z) {
        z = x < y ? x : y;
    }

    /// @dev Babylonian method.
    function sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}
