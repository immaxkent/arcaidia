// Vendored from immaxkent/uniswap-v2 (Arcaidia Line 1) at commit 30a494e — test support only, not deployed by this repository.
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The four assets this market offers, and the prices it opens at.
/// @dev Prices are micro-USDC per whole token — the same unit the pools, the bots and the
///      tests use, so nothing in this system ever converts through a float. The spread is
///      deliberate: mPEPE at ten micro-USDC and mETH at three thousand dollars are four
///      orders of magnitude apart on either side of a dollar, which is where a naive
///      6-versus-18 decimal conversion truncates to zero or overflows.
library MarketTokens {
    struct TokenSpec {
        string name;
        string symbol;
        uint256 priceUsdcPerToken;
    }

    uint256 internal constant COUNT = 4;
    uint256 internal constant BPS = 10_000;

    function specs() internal pure returns (TokenSpec[] memory list) {
        list = new TokenSpec[](COUNT);
        list[0] = TokenSpec("Arcaidia Mock Ether", "mETH", 3000e6);
        list[1] = TokenSpec("Arcaidia Mock Aave", "mAAVE", 200e6);
        list[2] = TokenSpec("Arcaidia Mock Graph", "mGRT", 1e5);
        list[3] = TokenSpec("Arcaidia Mock Pepe", "mPEPE", 10);
    }

    /// @notice Token units to pair with `usdcDepth` micro-USDC, at `priceUsdcPerToken`
    ///         offset by `scaleBps` (10_000 = the reference price, 10_300 = 3% dearer).
    ///
    /// @dev The offset is applied to the *token reserve*, not to the price, and that is
    ///      the whole reason this function takes the scale at all. Each chain opens at a
    ///      different offset so the arbitrage bot has a gap to close from the first block.
    ///      Applying a percentage to the price first truncates: mPEPE's reference price is
    ///      ten micro-USDC, so a 3% offset is 0.3 of a unit and integer division erases it,
    ///      leaving both chains at exactly ten and no gap at all. The token reserve has
    ///      twenty-four digits of room for the same offset, and the pool's effective price
    ///      is the ratio of the two reserves rather than either number alone.
    ///
    ///      Only the USDC side costs anything, since the mock side is minted. So
    ///      `usdcDepth` alone sets how far a given trade moves the price.
    function tokenReserveFor(uint256 usdcDepth, uint256 priceUsdcPerToken, uint256 scaleBps)
        internal
        pure
        returns (uint256 tokenReserve)
    {
        require(priceUsdcPerToken > 0, "MarketTokens: ZERO_PRICE");
        require(scaleBps > 0, "MarketTokens: ZERO_SCALE");
        tokenReserve = usdcDepth * 1e18 * BPS / (priceUsdcPerToken * scaleBps);
        require(tokenReserve > 0, "MarketTokens: RESERVE_ROUNDS_TO_ZERO");
    }
}
