// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The ERC-20 surface `UniswapV2SwapAdapter` uses. Merged into Arcaidia with it.
interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}
