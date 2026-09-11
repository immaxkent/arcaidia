// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ArcaidiaLiquidityVault} from "../src/ArcaidiaLiquidityVault.sol";

/// @notice Tunes a vault's fill limits away from the defaults `initialize()`
///         already set. Owner-only. Not required for a fresh vault to work —
///         `initialize()` bakes in 50%/80%/1.5% (see ArcaidiaLiquidityVault's
///         DEFAULT_MAX_*_BPS constants) — only for deliberately overriding them.
///
/// @dev All three values are now a live percentage of the vault's own
///      totalAssets(), not an absolute amount — see
///      ArcaidiaLiquidityVault.maxFillAmount()/maxOutstandingExposure(). A
///      vault that has never had setFillLimits called still fills correctly
///      at the baked-in defaults, which is the whole point: no operator step
///      is required before a freshly deployed vault — House or, later, a
///      permissionless LP one — can safely accept its first fill.
///
///      Usage:
///        VAULT_ADDRESS=0x... MAX_FILL_BPS=5000 MAX_EXPOSURE_BPS=8000 MAX_FEE_BPS=150 \
///          forge script script/SetFillLimits.s.sol \
///          --rpc-url $ETHEREUM_SEPOLIA_RPC_URL \
///          --account deployKey --sender <owner address> \
///          --broadcast
/// @dev v2 vaults only: the fee ceiling is the vault's immutable fee policy (D7), not a limit.
contract SetFillLimitsScript is Script {
    function run() external {
        address vaultAddress = vm.envAddress("VAULT_ADDRESS");
        uint16 maxFillBps = uint16(vm.envUint("MAX_FILL_BPS"));
        uint16 maxExposureBps = uint16(vm.envUint("MAX_EXPOSURE_BPS"));

        ArcaidiaLiquidityVault vault = ArcaidiaLiquidityVault(vaultAddress);

        console.log("chain id       ", block.chainid);
        console.log("vault          ", vaultAddress);
        console.log("maxFillBps     ", maxFillBps);
        console.log("maxExposureBps ", maxExposureBps);

        vm.startBroadcast();
        vault.setFillLimits(maxFillBps, maxExposureBps);
        vm.stopBroadcast();

        require(vault.maxFillBps() == maxFillBps, "maxFillBps did not take");
        require(vault.maxExposureBps() == maxExposureBps, "maxExposureBps did not take");
        console.log("fill limits set");
        console.log("  maxFillAmount() now     ", vault.maxFillAmount());
        console.log("  maxOutstandingExposure()", vault.maxOutstandingExposure());
    }
}
