// Vendored from immaxkent/uniswap-v2 (Arcaidia Line 1) at commit 30a494e — test support only, not deployed by this repository.
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @notice Canonical Uniswap V2 `UQ112x112` — a binary fixed point number,
///         range [0, 2**112 - 1], resolution 1 / 2**112.
/// @dev Neither operation can overflow a uint224 for uint112 inputs, so 0.8's
///      checked arithmetic changes nothing here.
library UQ112x112 {
    uint224 private constant Q112 = 2 ** 112;

    function encode(uint112 y) internal pure returns (uint224 z) {
        z = uint224(y) * Q112;
    }

    function uqdiv(uint224 x, uint112 y) internal pure returns (uint224 z) {
        z = x / uint224(y);
    }
}
