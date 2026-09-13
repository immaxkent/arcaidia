// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ArcaidiaLiquidityVault} from "../src/ArcaidiaLiquidityVault.sol";

/// @notice WP-34: point a vault at its chain's `ISwapAdapter` so trade intents (a non-USDC
///         `tokenOut`) are delivered through the swap instead of falling back to USDC. Owner-only,
///         no redeploy — `setSwapAdapter` is a plain owner call on the live vault (D9).
///
///      Usage (House Vault, deployer keystore):
///        VAULT_ADDRESS=0xB4bA190D5C78869366e7963f5CcCf4c3167d855C SWAP_ADAPTER=<chain's adapter> \
///          forge script script/SetSwapAdapter.s.sol \
///          --rpc-url $ARC_TESTNET_RPC_URL --account deployKey --sender <owner> --broadcast
///
///      The adapter addresses are the ones `packages/domain/src/config/markets.ts` holds
///      (`SWAP_INFRASTRUCTURE[chain].swapAdapter`). Independent vaults are re-pointed by their
///      owners from the console instead.
contract SetSwapAdapterScript is Script {
    function run() external {
        address vaultAddress = vm.envAddress("VAULT_ADDRESS");
        address adapter = vm.envAddress("SWAP_ADAPTER");

        ArcaidiaLiquidityVault vault = ArcaidiaLiquidityVault(vaultAddress);
        console.log("chain id    ", block.chainid);
        console.log("vault       ", vaultAddress);
        console.log("swap adapter", adapter);
        console.log("was         ", address(vault.swapAdapter()));

        vm.startBroadcast();
        vault.setSwapAdapter(adapter);
        vm.stopBroadcast();

        require(address(vault.swapAdapter()) == adapter, "swap adapter did not take");
        console.log("swap adapter set");
    }
}
