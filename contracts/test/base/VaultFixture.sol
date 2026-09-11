// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ChainFixture} from "./ChainFixture.sol";
import {MockUSDC} from "../../src/mocks/MockUSDC.sol";
import {VaultHarness} from "../harness/VaultHarness.sol";
import {ArcaidiaIntentMarket} from "../../src/ArcaidiaIntentMarket.sol";
import {ISettlementCheck} from "../../src/interfaces/ISettlementCheck.sol";
import {IVaultRegistry} from "../../src/interfaces/IVaultRegistry.sol";
import {MockVaultRegistry} from "./MockVaultRegistry.sol";
import {TestPolicies} from "./TestPolicies.sol";

/// @notice Never reports anything settled. Most vault suites don't exercise the
///         settlement-check interaction at all; they need a market to fill through,
///         not a real `SettlementReceiver`.
contract NeverSettledCheck is ISettlementCheck {
    function isSettled(bytes32) external pure returns (bool) {
        return false;
    }
}

/// @notice Shared setup for vault suites.
/// @dev The vault runs on the *destination* chain of the direction under test,
///      which is the mirror of the router fixture. Running the same assertions
///      with `ARCAIDIA_SOURCE` flipped is what proves both directions.
abstract contract VaultFixture is ChainFixture {
    MockUSDC internal asset;
    VaultHarness internal vault;
    ArcaidiaIntentMarket internal market;
    MockVaultRegistry internal registry;

    address internal vaultOwner = makeAddr("vaultOwner");
    address internal lpAlice = makeAddr("lpAlice");
    address internal lpBob = makeAddr("lpBob");
    address internal recipient = makeAddr("recipient");

    uint16 internal constant RESERVE_FLOOR_BPS = 1_000; // 10%
    uint16 internal constant DEFAULT_MAX_FILL_BPS = 5_000; // 50% of vault depth
    uint16 internal constant DEFAULT_MAX_EXPOSURE_BPS = 8_000; // 80% of vault depth

    function _deployVault() internal {
        _configureDirection();
        // The vault advances liquidity on the destination chain.
        vm.chainId(destinationChainId);

        asset = new MockUSDC();
        vault = new VaultHarness();
        vault.initialize(
            vaultOwner,
            address(asset),
            RESERVE_FLOOR_BPS,
            DEFAULT_MAX_FILL_BPS,
            DEFAULT_MAX_EXPOSURE_BPS,
            TestPolicies.permissive()
        );

        registry = new MockVaultRegistry();
        market = new ArcaidiaIntentMarket(
            ISettlementCheck(address(new NeverSettledCheck())), IVaultRegistry(address(registry))
        );
        vm.prank(vaultOwner);
        vault.setMarket(address(market));

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
