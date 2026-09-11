// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ArcaidiaLiquidityVault} from "../src/ArcaidiaLiquidityVault.sol";

/// @notice Grants (or revokes) the solver's fill-authorization signer on this
///         chain's House Vault. Owner-only — run once per chain.
///
/// @dev The vault address is the live, deployed address (2026-09-08,
///      script/Deploy.s.sol), identical on both chains via CREATE2 — not
///      re-derived here, matching how packages/domain/src/config/deployments.ts
///      treats it: a committed fact, not something to recompute per run.
///
///      Usage (grant):
///        forge script script/AuthorizeSolverSigner.s.sol \
///          --rpc-url $ETHEREUM_SEPOLIA_RPC_URL \
///          --account deployKey --sender <owner address> \
///          --broadcast
///      Usage (revoke): same, with REVOKE=true in the environment.
contract AuthorizeSolverSignerScript is Script {

    function run() external {
        // v2 (WP-31): any vault — the House Vault or an operator's own factory vault.
        address VAULT = vm.envAddress("VAULT_ADDRESS");
        address signer = vm.envAddress("SOLVER_SIGNER_ADDRESS");
        bool allowed = !vm.envOr("REVOKE", false);

        console.log("chain id  ", block.chainid);
        console.log("vault     ", VAULT);
        console.log("signer    ", signer);
        console.log("granting  ", allowed);

        vm.startBroadcast();
        ArcaidiaLiquidityVault(VAULT).setAuthorisedSigner(signer, allowed);
        vm.stopBroadcast();

        bool nowAuthorised = ArcaidiaLiquidityVault(VAULT).isAuthorisedSigner(signer);
        require(nowAuthorised == allowed, "grant did not take");
        console.log("isAuthorisedSigner now", nowAuthorised);
    }
}
