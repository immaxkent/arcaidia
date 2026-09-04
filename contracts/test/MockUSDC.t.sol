// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

contract MockUSDCTest is Test {
    MockUSDC internal usdc;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    function setUp() public {
        usdc = new MockUSDC();
    }

    /// Six decimals is not cosmetic: it matches both Sepolia USDC and Arc's
    /// ERC-20 facade, so amounts in tests carry the same meaning as on chain.
    function test_hasSixDecimals() public view {
        assertEq(usdc.decimals(), 6);
    }

    function test_hasUsdcSymbol() public view {
        assertEq(usdc.symbol(), "USDC");
    }

    function test_mintIncreasesBalanceAndSupply() public {
        usdc.mint(alice, 1_000e6);
        assertEq(usdc.balanceOf(alice), 1_000e6);
        assertEq(usdc.totalSupply(), 1_000e6);
    }

    function test_burnReducesBalanceAndSupply() public {
        usdc.mint(alice, 1_000e6);
        vm.prank(alice);
        usdc.burn(400e6);
        assertEq(usdc.balanceOf(alice), 600e6);
        assertEq(usdc.totalSupply(), 600e6);
    }

    function test_transferMovesBalance() public {
        usdc.mint(alice, 1_000e6);
        vm.prank(alice);
        usdc.transfer(bob, 250e6);
        assertEq(usdc.balanceOf(alice), 750e6);
        assertEq(usdc.balanceOf(bob), 250e6);
    }

    /// The router pulls funds with transferFrom, so approval semantics are part
    /// of the protocol's critical path rather than incidental ERC-20 behaviour.
    function test_transferFromRespectsAllowance() public {
        usdc.mint(alice, 1_000e6);
        vm.prank(alice);
        usdc.approve(bob, 300e6);

        vm.prank(bob);
        usdc.transferFrom(alice, bob, 300e6);

        assertEq(usdc.balanceOf(bob), 300e6);
        assertEq(usdc.allowance(alice, bob), 0);
    }

    function test_transferFromRevertsAboveAllowance() public {
        usdc.mint(alice, 1_000e6);
        vm.prank(alice);
        usdc.approve(bob, 100e6);

        vm.prank(bob);
        vm.expectRevert();
        usdc.transferFrom(alice, bob, 101e6);
    }

    function test_transferRevertsAboveBalance() public {
        usdc.mint(alice, 10e6);
        vm.prank(alice);
        vm.expectRevert();
        usdc.transfer(bob, 11e6);
    }

    function testFuzz_mintThenTransferConservesSupply(uint128 minted, uint128 sent) public {
        vm.assume(sent <= minted);
        usdc.mint(alice, minted);
        vm.prank(alice);
        usdc.transfer(bob, sent);
        assertEq(usdc.balanceOf(alice) + usdc.balanceOf(bob), usdc.totalSupply());
    }
}
