// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISwapAdapter} from "../interfaces/ISwapAdapter.sol";
import {IUniswapV2Router02} from "./interfaces/IUniswapV2Router02.sol";
import {IERC20Minimal} from "./interfaces/IERC20Minimal.sol";

/// @title UniswapV2SwapAdapter
/// @notice Destination-side trade execution for Arcaidia, over a Uniswap V2 router.
///
/// @dev This is the whole of Arcaidia's knowledge of Uniswap. `ArcaidiaLiquidityVault`
///      approves this contract for the USDC it has already booked as advanced, calls
///      `swapExactInput` inside `try/catch`, and delivers plain USDC on any revert. So a
///      revert here is a supported outcome, never a loss: the user receives exactly what
///      canonical settlement would have paid them.
///
///      Three properties the vault relies on, each pinned by a test:
///      - **No balances between calls.** Everything pulled in the same call is spent in it.
///      - **No callback into the caller.** The only external calls are to the token and the
///        router; the swap passes empty data, so no V2 flash-swap callback can fire.
///      - **`minOut` is enforced.** The router reverts below it, and this contract
///        independently re-checks what the recipient actually received.
///
///      The allowlist is directional and deliberately so. The vault only ever swaps its
///      own settlement asset into a user's requested `tokenOut`, so an owner enabling
///      `(USDC, mETH)` is not also enabling the reverse. Nothing here can be used to move
///      a token the owner has not named.
contract UniswapV2SwapAdapter is ISwapAdapter {
    IUniswapV2Router02 public immutable router;
    /// @notice The router's factory, cached at construction; pairs are resolved through it.
    address public immutable factory;

    address public owner;

    /// @notice Named by `transferOwnership`, effective only once it calls `acceptOwnership`.
    /// @dev Two steps because one is unforgiving: every privileged call on this contract is
    ///      `onlyOwner`, and a mistyped address in a single-step handover removes the pause,
    ///      the limits and the wiring from anyone's reach, permanently (MN-07 / C-20).
    address public pendingOwner;
    /// @notice `allowedPair[tokenIn][tokenOut]` — directional, owner-set.
    mapping(address => mapping(address => bool)) public allowedPair;

    event OwnerTransferred(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event PairAllowed(address indexed tokenIn, address indexed tokenOut, bool allowed);
    event SwapExecuted(
        address indexed tokenIn,
        address indexed tokenOut,
        address indexed recipient,
        uint256 amountIn,
        uint256 amountOut
    );

    error NotOwner();
    error NotPendingOwner(address caller);
    error ZeroAddress();
    error IdenticalTokens(address token);
    error PairNotAllowed(address tokenIn, address tokenOut);
    error ZeroAmount();
    error QuoteUnavailable(address tokenIn, address tokenOut);
    error InsufficientOutput(uint256 amountOut, uint256 minOut);
    error RouterReportMismatch(uint256 reported, uint256 delivered);
    error AdapterRetainedBalance(uint256 amount);
    error InvalidRecipient(address recipient);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address router_, address owner_) {
        if (router_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        router = IUniswapV2Router02(router_);
        factory = IUniswapV2Router02(router_).factory();
        owner = owner_;
        emit OwnerTransferred(address(0), owner_);
    }

    // --- Administration ----------------------------------------------------

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    /// @notice Take ownership named by the current owner. Only the named address can.
    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner(msg.sender);
        address previous = owner;
        owner = msg.sender;
        delete pendingOwner;
        emit OwnerTransferred(previous, msg.sender);
    }

    /// @notice Allow or forbid swapping `tokenIn` into `tokenOut` through this adapter.
    function setPairAllowed(address tokenIn, address tokenOut, bool allowed) public onlyOwner {
        if (tokenIn == address(0) || tokenOut == address(0)) revert ZeroAddress();
        if (tokenIn == tokenOut) revert IdenticalTokens(tokenIn);
        allowedPair[tokenIn][tokenOut] = allowed;
        emit PairAllowed(tokenIn, tokenOut, allowed);
    }

    /// @notice Allow or forbid a set of `tokenOut`s against one `tokenIn`, in that direction only.
    function setPairsAllowed(address tokenIn, address[] calldata tokensOut, bool allowed) external onlyOwner {
        for (uint256 i; i < tokensOut.length; i++) {
            setPairAllowed(tokenIn, tokensOut[i], allowed);
        }
    }

    // --- ISwapAdapter ------------------------------------------------------

    /// @inheritdoc ISwapAdapter
    function quote(address tokenIn, address tokenOut, uint256 amountIn)
        external
        view
        returns (uint256 amountOut)
    {
        if (!allowedPair[tokenIn][tokenOut]) revert PairNotAllowed(tokenIn, tokenOut);
        if (amountIn == 0) revert ZeroAmount();
        (bool priced, uint256 out) = _price(tokenIn, tokenOut, amountIn);
        if (!priced) revert QuoteUnavailable(tokenIn, tokenOut);
        amountOut = out;
    }

    /// @inheritdoc ISwapAdapter
    /// @dev Never reverts. The solver calls this to decide fill or ignore, and a revert
    ///      there would be indistinguishable from a transport fault; "no" is an answer.
    function canSatisfy(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut)
        external
        view
        returns (bool)
    {
        if (!allowedPair[tokenIn][tokenOut] || amountIn == 0) return false;
        (bool priced, uint256 out) = _price(tokenIn, tokenOut, amountIn);
        return priced && out >= minOut;
    }

    /// @inheritdoc ISwapAdapter
    function swapExactInput(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minOut,
        address recipient
    ) external returns (uint256 amountOut) {
        if (!allowedPair[tokenIn][tokenOut]) revert PairNotAllowed(tokenIn, tokenOut);
        if (amountIn == 0) revert ZeroAmount();
        if (recipient == address(0) || recipient == address(this)) revert InvalidRecipient(recipient);

        // Measured, not assumed: a donation to this contract must not be readable as output,
        // and any dust left behind by the router must fail the call rather than accumulate.
        uint256 heldBefore = IERC20Minimal(tokenIn).balanceOf(address(this));
        uint256 recipientBefore = IERC20Minimal(tokenOut).balanceOf(recipient);

        _pull(tokenIn, msg.sender, amountIn);
        _approve(tokenIn, address(router), amountIn);

        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;
        // The vault passes no deadline, by contract; `block.timestamp` makes this
        // transaction's own inclusion the deadline, which is the only meaningful one here.
        uint256[] memory amounts =
            router.swapExactTokensForTokens(amountIn, minOut, path, recipient, block.timestamp);

        _approve(tokenIn, address(router), 0);

        uint256 reported = amounts[amounts.length - 1];
        amountOut = IERC20Minimal(tokenOut).balanceOf(recipient) - recipientBefore;
        if (amountOut != reported) revert RouterReportMismatch(reported, amountOut);
        if (amountOut < minOut) revert InsufficientOutput(amountOut, minOut);

        uint256 heldAfter = IERC20Minimal(tokenIn).balanceOf(address(this));
        if (heldAfter != heldBefore) revert AdapterRetainedBalance(heldAfter - heldBefore);

        emit SwapExecuted(tokenIn, tokenOut, recipient, amountIn, amountOut);
    }

    // --- Internals ---------------------------------------------------------

    /// @dev The router's own pricing, with every failure — unknown pair, empty pool,
    ///      arithmetic — collapsed into `false` rather than propagated.
    function _price(address tokenIn, address tokenOut, uint256 amountIn)
        private
        view
        returns (bool priced, uint256 amountOut)
    {
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;
        try router.getAmountsOut(amountIn, path) returns (uint256[] memory amounts) {
            return (true, amounts[amounts.length - 1]);
        } catch {
            return (false, 0);
        }
    }

    function _pull(address token, address from, uint256 value) private {
        (bool success, bytes memory data) =
            token.call(abi.encodeWithSelector(IERC20Minimal.transferFrom.selector, from, address(this), value));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "SwapAdapter: TRANSFER_FROM_FAILED");
    }

    function _approve(address token, address spender, uint256 value) private {
        (bool success, bytes memory data) =
            token.call(abi.encodeWithSelector(IERC20Minimal.approve.selector, spender, value));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "SwapAdapter: APPROVE_FAILED");
    }
}
