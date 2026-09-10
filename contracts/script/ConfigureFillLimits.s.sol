// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ArcaidiaLiquidityVault} from "../src/ArcaidiaLiquidityVault.sol";

/// @notice Sets the House Vault's fill limits. Owner-only — run once per chain.
///
/// @dev Found live, 2026-09-10: `setFillLimits` was never called by
///      `ArcaidiaDeployment.sol` after `initialize()` — only `reserveFloorBps`
///      is set at init. `maxFillAmount`, `maxOutstandingExposure` and
///      `maxFeeBps` therefore defaulted to zero on both chains since the
///      2026-09-08 deploy, which makes `fastFill` revert unconditionally
///      (`FeeAboveProtocolCeiling(fee, 0)` is checked before the other two
///      zero-value caps, but all three would revert independently). Every
///      fast-fill attempt has failed for this reason, silently, until this
///      script exists — there was no deploy-time or ongoing check that caught
///      an unconfigured vault being otherwise fully live.
///
///      Defaults below assume the vault's current ~100 USDC of testnet
///      liquidity (see cast call liquidBalance()); adjust if that changes.
///      maxFeeBps=150 covers DEFAULT_RISK_POLICY's own ceiling (100 bps) plus
///      its slow-transport surcharge (25 bps) with headroom — the vault's cap
///      must never be tighter than what the risk engine can legitimately quote.
///
///      Usage:
///        forge script script/ConfigureFillLimits.s.sol \
///          --rpc-url $ETHEREUM_SEPOLIA_RPC_URL \
///          --account deployKey --sender <owner address> \
///          --broadcast
contract ConfigureFillLimitsScript is Script {
    address internal constant VAULT = 0x9F5813cD0Ea34403f78769076043436E67736da3;

    uint256 internal constant MAX_FILL_AMOUNT = 50_000_000; // 50 USDC per fill
    uint256 internal constant MAX_OUTSTANDING_EXPOSURE = 80_000_000; // 80 USDC in flight
    uint16 internal constant MAX_FEE_BPS = 150; // 1.5%

    function run() external {
        console.log("chain id                 ", block.chainid);
        console.log("vault                    ", VAULT);
        console.log("maxFillAmount            ", MAX_FILL_AMOUNT);
        console.log("maxOutstandingExposure   ", MAX_OUTSTANDING_EXPOSURE);
        console.log("maxFeeBps                ", MAX_FEE_BPS);

        vm.startBroadcast();
        ArcaidiaLiquidityVault(VAULT).setFillLimits(MAX_FILL_AMOUNT, MAX_OUTSTANDING_EXPOSURE, MAX_FEE_BPS);
        vm.stopBroadcast();

        require(ArcaidiaLiquidityVault(VAULT).maxFillAmount() == MAX_FILL_AMOUNT, "maxFillAmount did not take");
        require(
            ArcaidiaLiquidityVault(VAULT).maxOutstandingExposure() == MAX_OUTSTANDING_EXPOSURE,
            "maxOutstandingExposure did not take"
        );
        require(ArcaidiaLiquidityVault(VAULT).maxFeeBps() == MAX_FEE_BPS, "maxFeeBps did not take");
        console.log("fill limits set");
    }
}
