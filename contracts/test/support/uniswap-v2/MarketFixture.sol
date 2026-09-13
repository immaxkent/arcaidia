// Vendored from immaxkent/uniswap-v2 (Arcaidia Line 1) at commit 30a494e — test support only, not deployed by this repository.
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {UniswapV2Factory} from "./v2/UniswapV2Factory.sol";
import {UniswapV2Router02} from "./v2/UniswapV2Router02.sol";
import {IUniswapV2Pair} from "./v2/interfaces/IUniswapV2Pair.sol";
import {MintableERC20} from "./mocks/MintableERC20.sol";
import {MarketTokens} from "./market/MarketTokens.sol";

/// @notice One chain's market: a factory, a router, a 6-decimal USDC stand-in and
///         four 18-decimal assets, each pooled against USDC.
/// @dev Prices are expressed the way the deployment scripts express them — micro-USDC
///      per whole token — so tests and deployments share one unit convention and
///      neither has to reason in floating point. MockPEPE at 10 (one hundred-thousandth
///      of a dollar) is here deliberately: it is the case where a naive 6-versus-18
///      decimal conversion overflows or truncates to zero.
abstract contract MarketFixture is Test {
    UniswapV2Factory internal factory;
    UniswapV2Router02 internal router;

    MintableERC20 internal usdc;
    MintableERC20 internal mockEth;
    MintableERC20 internal mockAave;
    MintableERC20 internal mockGrt;
    MintableERC20 internal mockPepe;

    uint256 internal constant PRICE_ETH = 3000e6;
    uint256 internal constant PRICE_AAVE = 200e6;
    uint256 internal constant PRICE_GRT = 1e5;
    uint256 internal constant PRICE_PEPE = 10;

    function deployMarket() internal {
        factory = new UniswapV2Factory(address(this));
        router = new UniswapV2Router02(address(factory));

        usdc = new MintableERC20("USD Coin", "USDC", 6);
        mockEth = new MintableERC20("Mock Ether", "mETH", 18);
        mockAave = new MintableERC20("Mock Aave", "mAAVE", 18);
        mockGrt = new MintableERC20("Mock Graph", "mGRT", 18);
        mockPepe = new MintableERC20("Mock Pepe", "mPEPE", 18);
    }

    /// @notice Token units that pair with `usdcDepth` micro-USDC at `priceUsdcPerToken`.
    /// @dev Delegates to the library the deployment script uses, rather than restating the
    ///      formula: a fixture with its own copy of the maths can agree with itself while
    ///      both disagree with what actually gets deployed.
    function tokenReserveFor(uint256 usdcDepth, uint256 priceUsdcPerToken) internal pure returns (uint256) {
        return MarketTokens.tokenReserveFor(usdcDepth, priceUsdcPerToken, MarketTokens.BPS);
    }

    /// @notice Create and seed the USDC/`token` pool at a price, from this contract's balance.
    function seedPool(MintableERC20 token, uint256 usdcDepth, uint256 priceUsdcPerToken)
        internal
        returns (IUniswapV2Pair pair)
    {
        uint256 tokenDepth = tokenReserveFor(usdcDepth, priceUsdcPerToken);
        usdc.mint(address(this), usdcDepth);
        token.mint(address(this), tokenDepth);
        usdc.approve(address(router), usdcDepth);
        token.approve(address(router), tokenDepth);
        router.addLiquidity(
            address(usdc), address(token), usdcDepth, tokenDepth, 0, 0, address(this), block.timestamp
        );
        pair = IUniswapV2Pair(factory.getPair(address(usdc), address(token)));
    }

    /// @notice Seed all four pools at `usdcDepth` each.
    function seedAllPools(uint256 usdcDepth) internal {
        seedPool(mockEth, usdcDepth, PRICE_ETH);
        seedPool(mockAave, usdcDepth, PRICE_AAVE);
        seedPool(mockGrt, usdcDepth, PRICE_GRT);
        seedPool(mockPepe, usdcDepth, PRICE_PEPE);
    }

    /// @notice The pool's constant product, from live reserves.
    function kOf(IUniswapV2Pair pair) internal view returns (uint256) {
        (uint112 r0, uint112 r1,) = pair.getReserves();
        return uint256(r0) * uint256(r1);
    }

    /// @notice Micro-USDC per whole token, from live reserves.
    function priceOf(IUniswapV2Pair pair, address token) internal view returns (uint256) {
        (uint112 r0, uint112 r1,) = pair.getReserves();
        (uint256 usdcReserve, uint256 tokenReserve) =
            pair.token0() == address(usdc) ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
        require(pair.token0() == token || pair.token1() == token, "token not in pair");
        return usdcReserve * 1e18 / tokenReserve;
    }

    function swapUsdcFor(MintableERC20 token, uint256 amountIn, address who) internal returns (uint256) {
        usdc.mint(who, amountIn);
        address[] memory path = new address[](2);
        path[0] = address(usdc);
        path[1] = address(token);
        vm.startPrank(who);
        usdc.approve(address(router), amountIn);
        uint256[] memory amounts = router.swapExactTokensForTokens(amountIn, 0, path, who, block.timestamp);
        vm.stopPrank();
        return amounts[1];
    }

    function swapTokenForUsdc(MintableERC20 token, uint256 amountIn, address who) internal returns (uint256) {
        token.mint(who, amountIn);
        address[] memory path = new address[](2);
        path[0] = address(token);
        path[1] = address(usdc);
        vm.startPrank(who);
        token.approve(address(router), amountIn);
        uint256[] memory amounts = router.swapExactTokensForTokens(amountIn, 0, path, who, block.timestamp);
        vm.stopPrank();
        return amounts[1];
    }
}
