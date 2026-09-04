// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ChainFixture} from "./ChainFixture.sol";
import {MockUSDC} from "../../src/mocks/MockUSDC.sol";
import {VaultHarness} from "../harness/VaultHarness.sol";

/// @notice Shared setup for vault suites.
/// @dev The vault runs on the *destination* chain of the direction under test,
///      which is the mirror of the router fixture. Running the same assertions
///      with `ARCAIDIA_SOURCE` flipped is what proves both directions.
abstract contract VaultFixture is ChainFixture {
    MockUSDC internal asset;
    VaultHarness internal vault;

    address internal vaultOwner = makeAddr("vaultOwner");
    address internal lpAlice = makeAddr("lpAlice");
    address internal lpBob = makeAddr("lpBob");
    address internal recipient = makeAddr("recipient");

    uint16 internal constant RESERVE_FLOOR_BPS = 1_000; // 10%

    function _deployVault() internal {
        _configureDirection();
        // The vault advances liquidity on the destination chain.
        vm.chainId(destinationChainId);

        asset = new MockUSDC();
        vault = new VaultHarness();
        vault.initialize(vaultOwner, address(asset), RESERVE_FLOOR_BPS);

        asset.mint(lpAlice, 1_000_000e6);
        asset.mint(lpBob, 1_000_000e6);

        vm.prank(lpAlice);
        asset.approve(address(vault), type(uint256).max);
        vm.prank(lpBob);
        asset.approve(address(vault), type(uint256).max);
    }

    function _deposit(address lp, uint256 assets) internal returns (uint256 shares) {
        vm.prank(lp);
        return vault.deposit(assets, lp);
    }
}
