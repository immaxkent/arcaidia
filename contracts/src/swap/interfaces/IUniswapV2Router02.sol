// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The exact slice of the Uniswap V2 router `UniswapV2SwapAdapter` depends on.
/// @dev Deliberately minimal. This file is merged into the Arcaidia repository alongside
///      the adapter, where no Uniswap source exists; declaring only what is called keeps
///      that repository free of an AMM it does not otherwise know about.
interface IUniswapV2Router02 {
    function factory() external view returns (address);

    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external
        view
        returns (uint256[] memory amounts);

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}
