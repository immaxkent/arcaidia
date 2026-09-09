// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {SettlementReceiver} from "../src/SettlementReceiver.sol";

/// @notice Grants (or revokes) the settlement worker's reporter authorization
///         on this chain's SettlementReceiver. Owner-only — run once per chain.
///
/// @dev Mirrors AuthorizeSolverSigner.s.sol exactly, for the same reason: the
///      worker that calls `settle()` needs its own key, separate from
///      PROTOCOL_OWNER (a keystore-protected wallet that cannot sign
///      unattended in a background process) — the same signer/submitter
///      split WP-05/WP-11 already made for the solver.
///
///      The receiver address is the live, deployed address (2026-09-08,
///      script/Deploy.s.sol), identical on both chains via CREATE2.
///
///      Usage (grant):
///        forge script script/AuthorizeSettlementReporter.s.sol \
///          --rpc-url $ETHEREUM_SEPOLIA_RPC_URL \
///          --account deployKey --sender <owner address> \
///          --broadcast
///      Usage (revoke): same, with REVOKE=true in the environment.
contract AuthorizeSettlementReporterScript is Script {
    address internal constant SETTLEMENT_RECEIVER = 0xb634d0fDa74BacF730B1eF50a32b4c83f13f11fC;

    function run() external {
        address reporter = vm.envAddress("SETTLEMENT_REPORTER_ADDRESS");
        bool allowed = !vm.envOr("REVOKE", false);

        console.log("chain id            ", block.chainid);
        console.log("settlement receiver ", SETTLEMENT_RECEIVER);
        console.log("reporter            ", reporter);
        console.log("granting            ", allowed);

        vm.startBroadcast();
        SettlementReceiver(SETTLEMENT_RECEIVER).setReporter(reporter, allowed);
        vm.stopBroadcast();

        bool nowAuthorised = SettlementReceiver(SETTLEMENT_RECEIVER).isReporter(reporter);
        require(nowAuthorised == allowed, "grant did not take");
        console.log("isReporter now", nowAuthorised);
    }
}
