// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ArcaidiaDeployer} from "../src/deploy/ArcaidiaDeployer.sol";
import {ArcaidiaDeployment} from "../src/deploy/ArcaidiaDeployment.sol";

/// @notice Deploys Arcaidia to whichever chain the RPC points at.
///
/// @dev There is one script, not one per chain. Everything chain-specific comes
///      from environment configuration, so the Ethereum deployment and the Arc
///      deployment are the same command with a different `--rpc-url`.
///
///      The deployment logic itself lives in `ArcaidiaDeployment`, which the
///      test suite exercises in both directions. This file only reads config,
///      asserts the predicted addresses and broadcasts.
///
///      Usage:
///        forge script script/Deploy.s.sol \
///          --rpc-url $ETHEREUM_SEPOLIA_RPC_URL --broadcast
contract DeployScript is Script {
    /// @dev Arachnid's canonical CREATE2 proxy. Verified present at this address
    ///      on both Ethereum Sepolia and Arc testnet, which is what lets the
    ///      Arcaidia deployer itself share an address across chains.
    address internal constant ARACHNID_FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    /// @dev Salt for the deployer. Must never change: every protocol address
    ///      derives from the deployer's address.
    bytes32 internal constant DEPLOYER_SALT = keccak256("arcaidia.v1.deployer");

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        ArcaidiaDeployment.Config memory config = ArcaidiaDeployment.Config({
            owner: vm.envAddress("PROTOCOL_OWNER"),
            settlementAsset: vm.envAddress("SETTLEMENT_ASSET"),
            settlementInitiator: vm.envAddress("SETTLEMENT_INITIATOR"),
            destinationChainId: vm.envUint("DESTINATION_CHAIN_ID"),
            destinationSettlementReceiver: vm.envAddress("DESTINATION_SETTLEMENT_RECEIVER"),
            reserveFloorBps: uint16(vm.envUint("RESERVE_FLOOR_BPS")),
            maxIntentAmount: vm.envUint("MAX_INTENT_AMOUNT"),
            maxInFlightValue: vm.envUint("MAX_IN_FLIGHT_VALUE"),
            settlementReporter: vm.envAddress("SETTLEMENT_REPORTER")
        });

        require(ARACHNID_FACTORY.code.length > 0, "CREATE2 factory missing on this chain");

        vm.startBroadcast(deployerKey);

        ArcaidiaDeployer deployer = _ensureDeployer();
        ArcaidiaDeployment.Deployment memory predicted = ArcaidiaDeployment.predict(deployer);

        console.log("chain id                ", block.chainid);
        console.log("arcaidia deployer       ", address(deployer));
        console.log("predicted router        ", predicted.router);
        console.log("predicted vault         ", predicted.vault);
        console.log("predicted receiver      ", predicted.settlementReceiver);

        ArcaidiaDeployment.Deployment memory deployment = ArcaidiaDeployment.deployAll(deployer, config);

        vm.stopBroadcast();

        // Asserted after broadcasting as well as inside the deployer, because
        // this is the WP-01 acceptance criterion and it should fail loudly.
        require(deployment.router == predicted.router, "router address mismatch");
        require(deployment.vault == predicted.vault, "vault address mismatch");
        require(deployment.settlementReceiver == predicted.settlementReceiver, "receiver address mismatch");

        console.log("--- deployed ---");
        console.log("ArcaidiaIntentRouter    ", deployment.router);
        console.log("ArcaidiaLiquidityVault  ", deployment.vault);
        console.log("SettlementReceiver      ", deployment.settlementReceiver);
        console.log("owner                   ", config.owner);
    }

    /// @dev Deploys the Arcaidia deployer through Arachnid's proxy if it is not
    ///      already present, so both chains resolve it to the same address.
    function _ensureDeployer() internal returns (ArcaidiaDeployer) {
        bytes memory creationCode = type(ArcaidiaDeployer).creationCode;
        address predicted = address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            bytes1(0xff), ARACHNID_FACTORY, DEPLOYER_SALT, keccak256(creationCode)
                        )
                    )
                )
            )
        );

        if (predicted.code.length == 0) {
            (bool ok,) = ARACHNID_FACTORY.call(abi.encodePacked(DEPLOYER_SALT, creationCode));
            require(ok, "deployer deployment failed");
            require(predicted.code.length > 0, "deployer missing after deployment");
        }

        return ArcaidiaDeployer(predicted);
    }
}
