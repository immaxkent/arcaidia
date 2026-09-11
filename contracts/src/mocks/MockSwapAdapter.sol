// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ISwapAdapter} from "../interfaces/ISwapAdapter.sol";
import {MockUSDC} from "./MockUSDC.sol";

/// @title MockSwapAdapter
/// @notice Test double for the Line 1 (Uniswap) adapter — a fixed-rate "market" in
///         `tokenOut` (a `MockUSDC`-shaped mintable token) so the vault's delivery seam can be
///         exercised in every mode: success, revert (unsupported pair / below `minOut`), and
///         a misbehaving adapter that reverts unconditionally.
contract MockSwapAdapter is ISwapAdapter {
    enum Mode {
        HONEST,
        ALWAYS_REVERT
    }

    /// @dev `tokenOut` units per `tokenIn` unit, in 1e18 fixed point.
    mapping(address => mapping(address => uint256)) public rate;
    Mode public mode;
    uint256 public lastAmountIn;

    error UnsupportedPair(address tokenIn, address tokenOut);
    error InsufficientOutput(uint256 amountOut, uint256 minOut);
    error Broken();

    function setRate(address tokenIn, address tokenOut, uint256 rate1e18) external {
        rate[tokenIn][tokenOut] = rate1e18;
    }

    function setMode(Mode value) external {
        mode = value;
    }

    function quote(address tokenIn, address tokenOut, uint256 amountIn) public view returns (uint256) {
        uint256 r = rate[tokenIn][tokenOut];
        if (r == 0) revert UnsupportedPair(tokenIn, tokenOut);
        return (amountIn * r) / 1e18;
    }

    function canSatisfy(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut) external view returns (bool) {
        if (mode == Mode.ALWAYS_REVERT || rate[tokenIn][tokenOut] == 0) return false;
        return quote(tokenIn, tokenOut, amountIn) >= minOut;
    }

    function swapExactInput(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address recipient)
        external
        returns (uint256 amountOut)
    {
        if (mode == Mode.ALWAYS_REVERT) revert Broken();
        amountOut = quote(tokenIn, tokenOut, amountIn);
        if (amountOut < minOut) revert InsufficientOutput(amountOut, minOut);

        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        lastAmountIn = amountIn;
        MockUSDC(tokenOut).mint(recipient, amountOut);
    }
}
