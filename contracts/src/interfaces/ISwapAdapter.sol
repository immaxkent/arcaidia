// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title ISwapAdapter
/// @notice The destination-side trade execution seam (DECISIONS.md D9). Frozen here for the
///         Line 1 (Uniswap) workstream — see `work-packages/LINE-1-UNISWAP-INTERFACE.md`.
/// @dev The vault is the only core caller. It approves `amountIn` of `tokenIn` (USDC), calls
///      `swapExactInput` inside `try/catch`, and on any revert delivers USDC to the recipient
///      instead. Implementations MUST NOT hold balances between calls and MUST NOT call back
///      into `msg.sender`.
interface ISwapAdapter {
    /// @notice Expected output for an exact-input swap right now. Pure quote; no state change.
    function quote(address tokenIn, address tokenOut, uint256 amountIn)
        external
        view
        returns (uint256 amountOut);

    /// @notice True iff this adapter supports the pair and `quote(...) >= minOut` right now.
    function canSatisfy(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut)
        external
        view
        returns (bool);

    /// @notice Pull `amountIn` of `tokenIn` from `msg.sender` (caller approves first), swap,
    ///         deliver `tokenOut` to `recipient`. MUST revert if `amountOut < minOut`.
    /// @return amountOut What was actually delivered to `recipient`.
    function swapExactInput(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minOut,
        address recipient
    ) external returns (uint256 amountOut);
}
