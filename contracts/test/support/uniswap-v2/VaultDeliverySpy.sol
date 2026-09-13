// Vendored from immaxkent/uniswap-v2 (Arcaidia Line 1) at commit 30a494e — test support only, not deployed by this repository.
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISwapAdapter} from "../../../src/interfaces/ISwapAdapter.sol";
import {IERC20Minimal} from "../../../src/swap/interfaces/IERC20Minimal.sol";

/// @notice A faithful copy of `ArcaidiaLiquidityVault._deliver`, so the adapter is
///         exercised exactly as the real vault exercises it.
/// @dev Copied deliberately rather than imported: this repository must not depend on
///      Arcaidia, and the point of the copy is to prove the *seam* — approve, call inside
///      `try/catch`, fall back to transferring the settlement asset on any revert, and
///      leave no standing allowance either way.
contract VaultDeliverySpy {
    event DeliveredViaSwap(bytes32 indexed intentId, address indexed tokenOut, uint256 amountOut);
    event SwapFellBack(bytes32 indexed intentId, address indexed tokenOut, uint256 usdcDelivered);

    ISwapAdapter public swapAdapter;
    IERC20Minimal public immutable asset;

    constructor(address asset_) {
        asset = IERC20Minimal(asset_);
    }

    function setSwapAdapter(address adapter) external {
        swapAdapter = ISwapAdapter(adapter);
    }

    function deliver(bytes32 intentId, address recipient, uint256 outputAmount, address tokenOut, uint256 minOut)
        external
    {
        ISwapAdapter adapter = swapAdapter;
        if (tokenOut == address(0) || address(adapter) == address(0)) {
            _transfer(recipient, outputAmount);
            return;
        }

        _approve(address(adapter), outputAmount);
        try adapter.swapExactInput(address(asset), tokenOut, outputAmount, minOut, recipient) returns (
            uint256 amountOut
        ) {
            _approve(address(adapter), 0);
            emit DeliveredViaSwap(intentId, tokenOut, amountOut);
        } catch {
            _approve(address(adapter), 0);
            _transfer(recipient, outputAmount);
            emit SwapFellBack(intentId, tokenOut, outputAmount);
        }
    }

    function _approve(address spender, uint256 value) private {
        (bool ok,) = address(asset).call(abi.encodeWithSelector(IERC20Minimal.approve.selector, spender, value));
        require(ok, "approve failed");
    }

    function _transfer(address to, uint256 value) private {
        (bool ok,) = address(asset).call(abi.encodeWithSignature("transfer(address,uint256)", to, value));
        require(ok, "transfer failed");
    }
}

/// @notice A recipient that records any Uniswap flash-swap callback.
/// @dev The adapter must never give the recipient control: it passes empty swap data, so
///      `uniswapV2Call` cannot fire. If it ever did, a recipient could re-enter the vault.
contract CallbackSpy {
    bool public wasCalledBack;

    function uniswapV2Call(address, uint256, uint256, bytes calldata) external {
        wasCalledBack = true;
    }
}

/// @notice An ERC-20 that can be pooled but can never be paid out.
/// @dev `transferFrom` works, so liquidity can be added; `transfer` always reverts, and
///      `transfer` is what the pair uses to pay a swap's output. It stands in for every
///      way the AMM leg can fail after the vault has already committed: a broken token, a
///      paused one, a pool that cannot deliver. The vault must still pay the user.
contract RevertingToken {
    string public name = "Reverting";
    string public symbol = "RVT";
    uint8 public decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 value) external {
        balanceOf[to] += value;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        return true;
    }

    function transfer(address, uint256) external pure returns (bool) {
        revert("RevertingToken: payout refused");
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        if (allowance[from][msg.sender] != type(uint256).max) {
            allowance[from][msg.sender] -= value;
        }
        balanceOf[from] -= value;
        balanceOf[to] += value;
        return true;
    }
}
