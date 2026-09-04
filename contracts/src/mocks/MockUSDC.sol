// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockUSDC
/// @notice Freely mintable six-decimal stand-in for USDC, for development and
///         deterministic tests only.
/// @dev This is NOT a second code path. The protocol only ever holds a
///      configured `IERC20 settlementAsset`; whether that address points here or
///      at real USDC is a deployment decision. There is no runtime mock/real
///      switch anywhere in Arcaidia, and adding one would break the invariant
///      that agent and vault logic are identical in test and in production.
///
///      Six decimals deliberately matches both target chains: Sepolia USDC is a
///      six-decimal ERC-20, and Arc's ERC-20 facade over its native USDC gas
///      token also reports six.
contract MockUSDC is ERC20 {
    uint8 private constant DECIMALS = 6;

    constructor() ERC20("Mock USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return DECIMALS;
    }

    /// @notice Mint to any address. Unrestricted by design: development only.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Burn from the caller, so tests can model balance reduction.
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
