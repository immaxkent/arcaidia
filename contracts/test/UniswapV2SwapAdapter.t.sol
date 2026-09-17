// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MarketFixture} from "./support/uniswap-v2/MarketFixture.sol";
import {VaultDeliverySpy, CallbackSpy, RevertingToken} from "./support/uniswap-v2/VaultDeliverySpy.sol";
import {UniswapV2SwapAdapter} from "../src/swap/UniswapV2SwapAdapter.sol";
import {ISwapAdapter} from "../src/interfaces/ISwapAdapter.sol";
import {IUniswapV2Pair} from "./support/uniswap-v2/v2/interfaces/IUniswapV2Pair.sol";
import {MintableERC20} from "./support/uniswap-v2/mocks/MintableERC20.sol";

/// @notice The adapter against a real, locally deployed V2 pair.
/// @dev Every assertion here is about a property `ArcaidiaLiquidityVault` depends on. The
///      vault wraps `swapExactInput` in `try/catch` and delivers USDC on any revert, so
///      "it reverts" is a supported outcome — what must never happen is a silent wrong
///      amount, a retained balance, or the recipient gaining control of execution.
contract UniswapV2SwapAdapterTest is MarketFixture {
    uint256 internal constant DEPTH = 40e6;
    address internal constant RECIPIENT = address(0xBEEF01);
    address internal constant STRANGER = address(0xDEAD);

    UniswapV2SwapAdapter internal adapter;

    function setUp() public {
        deployMarket();
        seedAllPools(DEPTH);

        adapter = new UniswapV2SwapAdapter(address(router), address(this));
        address[] memory tokensOut = new address[](3);
        tokensOut[0] = address(mockEth);
        tokensOut[1] = address(mockAave);
        tokensOut[2] = address(mockGrt);
        adapter.setPairsAllowed(address(usdc), tokensOut, true);
    }

    // --- Construction and administration -----------------------------------

    function test_constructorCachesTheRoutersOwnFactory() public view {
        assertEq(address(adapter.router()), address(router));
        assertEq(adapter.factory(), address(factory), "factory read from the router, never passed in");
        assertEq(adapter.owner(), address(this));
    }

    function test_constructorRejectsZeroAddresses() public {
        vm.expectRevert(UniswapV2SwapAdapter.ZeroAddress.selector);
        new UniswapV2SwapAdapter(address(0), address(this));

        vm.expectRevert(UniswapV2SwapAdapter.ZeroAddress.selector);
        new UniswapV2SwapAdapter(address(router), address(0));
    }

    function test_onlyTheOwnerChangesTheAllowlist() public {
        vm.prank(STRANGER);
        vm.expectRevert(UniswapV2SwapAdapter.NotOwner.selector);
        adapter.setPairAllowed(address(usdc), address(mockPepe), true);

        adapter.setPairAllowed(address(usdc), address(mockPepe), true);
        assertTrue(adapter.allowedPair(address(usdc), address(mockPepe)));
    }

    /// @dev Allowing USDC into a token must not also allow that token into USDC. The vault
    ///      only ever swaps its own settlement asset outward.
    function test_theAllowlistIsDirectional() public view {
        assertTrue(adapter.allowedPair(address(usdc), address(mockEth)), "outward allowed");
        assertFalse(adapter.allowedPair(address(mockEth), address(usdc)), "inward is a separate grant");
    }

    function test_ownershipTransfersInTwoSteps() public {
        adapter.transferOwnership(STRANGER);
        assertEq(adapter.owner(), address(this), "unchanged until accepted (MN-07)");

        vm.prank(STRANGER);
        adapter.acceptOwnership();
        assertEq(adapter.owner(), STRANGER);

        vm.expectRevert(UniswapV2SwapAdapter.NotOwner.selector);
        adapter.setPairAllowed(address(usdc), address(mockPepe), true);
    }

    // --- quote -------------------------------------------------------------

    function test_quoteMatchesTheRouter() public view {
        address[] memory path = new address[](2);
        path[0] = address(usdc);
        path[1] = address(mockAave);
        assertEq(adapter.quote(address(usdc), address(mockAave), 3e6), router.getAmountsOut(3e6, path)[1]);
    }

    function test_quoteRevertsOnAPairTheOwnerHasNotAllowed() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                UniswapV2SwapAdapter.PairNotAllowed.selector, address(usdc), address(mockPepe)
            )
        );
        adapter.quote(address(usdc), address(mockPepe), 1e6);
    }

    function test_quoteRevertsOnZeroInput() public {
        vm.expectRevert(UniswapV2SwapAdapter.ZeroAmount.selector);
        adapter.quote(address(usdc), address(mockAave), 0);
    }

    /// @dev Allowlisted but unpriceable: the owner allowed a pair the factory has no pool for.
    function test_quoteRevertsWhenTheRouterCannotPrice() public {
        MintableERC20 orphan = new MintableERC20("Orphan", "ORP", 18);
        adapter.setPairAllowed(address(usdc), address(orphan), true);

        vm.expectRevert(
            abi.encodeWithSelector(UniswapV2SwapAdapter.QuoteUnavailable.selector, address(usdc), address(orphan))
        );
        adapter.quote(address(usdc), address(orphan), 1e6);
    }

    // --- canSatisfy --------------------------------------------------------

    function test_canSatisfyIsTrueAtOrBelowTheQuoteAndFalseAbove() public view {
        uint256 quoted = adapter.quote(address(usdc), address(mockAave), 3e6);

        assertTrue(adapter.canSatisfy(address(usdc), address(mockAave), 3e6, quoted), "exactly the quote");
        assertTrue(adapter.canSatisfy(address(usdc), address(mockAave), 3e6, quoted - 1), "below it");
        assertFalse(adapter.canSatisfy(address(usdc), address(mockAave), 3e6, quoted + 1), "above it");
    }

    /// @dev The solver calls this to decide fill or ignore. A revert would be
    ///      indistinguishable from a transport fault, so every failure must read as "no".
    function test_canSatisfyNeverRevertsOnAnyUnanswerableInput() public {
        assertFalse(adapter.canSatisfy(address(usdc), address(mockPepe), 1e6, 0), "pair not allowed");
        assertFalse(adapter.canSatisfy(address(usdc), address(mockAave), 0, 0), "zero input");

        MintableERC20 orphan = new MintableERC20("Orphan", "ORP", 18);
        adapter.setPairAllowed(address(usdc), address(orphan), true);
        assertFalse(adapter.canSatisfy(address(usdc), address(orphan), 1e6, 0), "no pool exists");

        assertFalse(adapter.canSatisfy(STRANGER, address(mockAave), 1e6, 0), "input token is not a token");
    }

    // --- swapExactInput ----------------------------------------------------

    function test_swapDeliversTheQuotedAmountToTheRecipient() public {
        uint256 amountIn = 3e6;
        uint256 quoted = adapter.quote(address(usdc), address(mockAave), amountIn);

        uint256 delivered = _swapAs(STRANGER, address(mockAave), amountIn, quoted);

        assertEq(delivered, quoted, "returns what was quoted");
        assertEq(mockAave.balanceOf(RECIPIENT), quoted, "the recipient holds exactly that");
        assertEq(usdc.balanceOf(STRANGER), 0, "the caller's input was spent in full");
    }

    function test_swapRevertsBelowMinOutAndMovesNothing() public {
        uint256 amountIn = 3e6;
        uint256 quoted = adapter.quote(address(usdc), address(mockAave), amountIn);

        usdc.mint(STRANGER, amountIn);
        vm.startPrank(STRANGER);
        usdc.approve(address(adapter), amountIn);
        vm.expectRevert("UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT");
        adapter.swapExactInput(address(usdc), address(mockAave), amountIn, quoted + 1, RECIPIENT);
        vm.stopPrank();

        assertEq(usdc.balanceOf(STRANGER), amountIn, "the caller keeps its USDC");
        assertEq(mockAave.balanceOf(RECIPIENT), 0, "the recipient received nothing");
    }

    function test_swapRevertsOnAPairTheOwnerHasNotAllowed() public {
        usdc.mint(STRANGER, 1e6);
        vm.startPrank(STRANGER);
        usdc.approve(address(adapter), 1e6);
        vm.expectRevert(
            abi.encodeWithSelector(
                UniswapV2SwapAdapter.PairNotAllowed.selector, address(usdc), address(mockPepe)
            )
        );
        adapter.swapExactInput(address(usdc), address(mockPepe), 1e6, 0, RECIPIENT);
        vm.stopPrank();
    }

    function test_swapRejectsDegenerateArguments() public {
        vm.startPrank(STRANGER);
        vm.expectRevert(UniswapV2SwapAdapter.ZeroAmount.selector);
        adapter.swapExactInput(address(usdc), address(mockAave), 0, 0, RECIPIENT);

        vm.expectRevert(
            abi.encodeWithSelector(UniswapV2SwapAdapter.InvalidRecipient.selector, address(0))
        );
        adapter.swapExactInput(address(usdc), address(mockAave), 1e6, 0, address(0));

        vm.expectRevert(
            abi.encodeWithSelector(UniswapV2SwapAdapter.InvalidRecipient.selector, address(adapter))
        );
        adapter.swapExactInput(address(usdc), address(mockAave), 1e6, 0, address(adapter));
        vm.stopPrank();
    }

    /// @dev The vault approves exactly `amountIn`. Anything the adapter kept would be
    ///      vault capital stranded in a contract with no way to recover it.
    function test_adapterKeepsNoBalanceAndNoStandingAllowance() public {
        _swapAs(STRANGER, address(mockAave), 3e6, 0);

        assertEq(usdc.balanceOf(address(adapter)), 0, "no input retained");
        assertEq(mockAave.balanceOf(address(adapter)), 0, "no output retained");
        assertEq(usdc.allowance(address(adapter), address(router)), 0, "router allowance zeroed");
    }

    /// @dev A donation must not be readable as swap output, and must not be spendable.
    function test_aDonationToTheAdapterIsNeitherOutputNorSpendable() public {
        usdc.mint(address(adapter), 500e6);

        uint256 quoted = adapter.quote(address(usdc), address(mockAave), 3e6);
        uint256 delivered = _swapAs(STRANGER, address(mockAave), 3e6, 0);

        assertEq(delivered, quoted, "the donation did not inflate the output");
        assertEq(usdc.balanceOf(address(adapter)), 500e6, "and it is still sitting there, untouched");
    }

    /// @dev If the recipient could be called back mid-swap it could re-enter the vault.
    ///      The adapter passes empty swap data, so V2's flash-swap callback cannot fire.
    function test_theRecipientIsNeverGivenControl() public {
        CallbackSpy spy = new CallbackSpy();
        _swapAs(STRANGER, address(mockAave), 3e6, 0, address(spy));

        assertFalse(spy.wasCalledBack(), "no flash-swap callback reached the recipient");
        assertGt(mockAave.balanceOf(address(spy)), 0, "it was still paid");
    }

    /// @notice The brief's fuzz: what the function returns is what the recipient received.
    function testFuzz_returnedAmountEqualsWhatTheRecipientReceived(uint256 amountIn, uint8 which) public {
        MintableERC20 tokenOut = _tokenFor(which);
        amountIn = bound(amountIn, 1e3, 20e6);

        uint256 quoted = adapter.quote(address(usdc), address(tokenOut), amountIn);
        uint256 before = tokenOut.balanceOf(RECIPIENT);

        uint256 returned = _swapAs(STRANGER, address(tokenOut), amountIn, 0);

        assertEq(returned, tokenOut.balanceOf(RECIPIENT) - before, "return value is the recipient's delta");
        assertEq(returned, quoted, "and it is what the quote promised");
    }

    function testFuzz_canSatisfyAgreesWithWhatTheSwapDelivers(uint256 amountIn, uint256 minOut) public {
        amountIn = bound(amountIn, 1e3, 20e6);
        uint256 quoted = adapter.quote(address(usdc), address(mockGrt), amountIn);
        minOut = bound(minOut, 0, quoted * 2);

        bool predicted = adapter.canSatisfy(address(usdc), address(mockGrt), amountIn, minOut);

        usdc.mint(STRANGER, amountIn);
        vm.startPrank(STRANGER);
        usdc.approve(address(adapter), amountIn);
        try adapter.swapExactInput(address(usdc), address(mockGrt), amountIn, minOut, RECIPIENT) returns (
            uint256 delivered
        ) {
            assertTrue(predicted, "a swap that succeeded must have been predicted satisfiable");
            assertGe(delivered, minOut, "and it cleared the floor");
        } catch {
            assertFalse(predicted, "a swap that failed must not have been predicted satisfiable");
        }
        vm.stopPrank();
    }

    // --- The vault seam ----------------------------------------------------

    /// @notice The whole integration, through a copy of the vault's own delivery path.
    function test_vaultDeliversTheTokenWhenTheSwapSucceeds() public {
        VaultDeliverySpy vault = new VaultDeliverySpy(address(usdc));
        vault.setSwapAdapter(address(adapter));
        usdc.mint(address(vault), 5e6);

        uint256 quoted = adapter.quote(address(usdc), address(mockEth), 5e6);
        vm.expectEmit(true, true, false, true, address(vault));
        emit VaultDeliverySpy.DeliveredViaSwap(bytes32(uint256(1)), address(mockEth), quoted);
        vault.deliver(bytes32(uint256(1)), RECIPIENT, 5e6, address(mockEth), quoted);

        assertEq(mockEth.balanceOf(RECIPIENT), quoted, "recipient holds the token");
        assertEq(usdc.balanceOf(RECIPIENT), 0, "and no USDC");
        assertEq(usdc.allowance(address(vault), address(adapter)), 0, "no standing allowance left");
    }

    /// @notice The other half: an unmeetable floor must pay USDC, not strand the intent.
    function test_vaultFallsBackToUsdcWhenTheFloorCannotBeMet() public {
        VaultDeliverySpy vault = new VaultDeliverySpy(address(usdc));
        vault.setSwapAdapter(address(adapter));
        usdc.mint(address(vault), 5e6);

        uint256 unreachable = adapter.quote(address(usdc), address(mockEth), 5e6) * 2;
        vm.expectEmit(true, true, false, true, address(vault));
        emit VaultDeliverySpy.SwapFellBack(bytes32(uint256(2)), address(mockEth), 5e6);
        vault.deliver(bytes32(uint256(2)), RECIPIENT, 5e6, address(mockEth), unreachable);

        assertEq(usdc.balanceOf(RECIPIENT), 5e6, "recipient was made whole in USDC");
        assertEq(mockEth.balanceOf(RECIPIENT), 0, "and holds none of the token");
        assertEq(usdc.allowance(address(vault), address(adapter)), 0, "no standing allowance left");
    }

    function test_vaultFallsBackWhenThePairIsNotAllowed() public {
        VaultDeliverySpy vault = new VaultDeliverySpy(address(usdc));
        vault.setSwapAdapter(address(adapter));
        usdc.mint(address(vault), 5e6);

        vault.deliver(bytes32(uint256(3)), RECIPIENT, 5e6, address(mockPepe), 0);
        assertEq(usdc.balanceOf(RECIPIENT), 5e6, "an unsupported token pays USDC");
    }

    /// @dev A token that reverts on transfer stands in for every way the AMM can fail
    ///      mid-swap. The vault must still pay the user.
    function test_vaultFallsBackWhenTheSwapItselfReverts() public {
        RevertingToken bad = new RevertingToken();
        bad.mint(address(this), 1_000e18);
        usdc.mint(address(this), 40e6);
        usdc.approve(address(router), 40e6);
        bad.approve(address(router), 1_000e18);
        router.addLiquidity(address(usdc), address(bad), 40e6, 1_000e18, 0, 0, address(this), block.timestamp);
        adapter.setPairAllowed(address(usdc), address(bad), true);

        VaultDeliverySpy vault = new VaultDeliverySpy(address(usdc));
        vault.setSwapAdapter(address(adapter));
        usdc.mint(address(vault), 5e6);

        vault.deliver(bytes32(uint256(4)), RECIPIENT, 5e6, address(bad), 0);
        assertEq(usdc.balanceOf(RECIPIENT), 5e6, "the user is paid whatever the AMM does");
    }

    /// @dev With no adapter set the vault transfers USDC directly — the pre-Line-1 behaviour
    ///      every deployed vault has today, which must keep working after this ships.
    function test_vaultWithNoAdapterStillPaysUsdc() public {
        VaultDeliverySpy vault = new VaultDeliverySpy(address(usdc));
        usdc.mint(address(vault), 5e6);

        vault.deliver(bytes32(uint256(5)), RECIPIENT, 5e6, address(mockEth), 0);
        assertEq(usdc.balanceOf(RECIPIENT), 5e6, "unset adapter means plain USDC");
    }

    // --- helpers -----------------------------------------------------------

    function _swapAs(address caller, address tokenOut, uint256 amountIn, uint256 minOut)
        private
        returns (uint256)
    {
        return _swapAs(caller, tokenOut, amountIn, minOut, RECIPIENT);
    }

    function _swapAs(
        address caller,
        address tokenOut,
        uint256 amountIn,
        uint256 minOut,
        address recipient
    ) private returns (uint256 delivered) {
        usdc.mint(caller, amountIn);
        vm.startPrank(caller);
        usdc.approve(address(adapter), amountIn);
        delivered = adapter.swapExactInput(address(usdc), tokenOut, amountIn, minOut, recipient);
        vm.stopPrank();
    }

    function _tokenFor(uint8 which) private view returns (MintableERC20) {
        uint8 index = which % 3;
        if (index == 0) return mockEth;
        if (index == 1) return mockAave;
        return mockGrt;
    }
}
