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
///      Usage (keystore-cached wallet, no plaintext key anywhere):
///        forge script script/Deploy.s.sol \
///          --rpc-url $ETHEREUM_SEPOLIA_RPC_URL \
///          --account <cast-wallet-name> --sender <that-account's-address> \
///          --broadcast
///
///      Usage (plaintext key via DEPLOYER_PRIVATE_KEY, e.g. CI or local anvil):
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

    uint256 internal constant ETHEREUM_SEPOLIA = 11155111;
    uint256 internal constant ARC_TESTNET = 5042002;

    /// @dev Real testnet USDC, permanent addresses (work-packages/OPEN-QUESTIONS.md
    ///      Q3) — not secrets, so they need no env entry for the two chains we
    ///      actually target. `vm.envOr` still lets an anvil/other-chain run
    ///      override this with a freshly-deployed MockUSDC without touching code.
    function _defaultSettlementAsset(uint256 chainId) internal pure returns (address) {
        if (chainId == ETHEREUM_SEPOLIA) return 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
        if (chainId == ARC_TESTNET) return 0x3600000000000000000000000000000000000000;
        return address(0);
    }

    /// @dev The other of Arcaidia's two supported chains — also not a secret,
    ///      just the fact that this protocol has exactly two sides.
    function _defaultDestinationChainId(uint256 chainId) internal pure returns (uint256) {
        if (chainId == ETHEREUM_SEPOLIA) return ARC_TESTNET;
        if (chainId == ARC_TESTNET) return ETHEREUM_SEPOLIA;
        return 0;
    }

    /// @dev The one genuinely per-deploy value: which MockSettlementInitiator
    ///      (WP-06) — or, once WP-10 lands, which real CCTP adapter — this chain
    ///      should wire in. Chain-suffixed so one .env holds both chains' values
    ///      at once with no collision; SETTLEMENT_INITIATOR is the fallback for
    ///      an unrecognised chain (anvil, a future network).
    function _settlementInitiator(uint256 chainId) internal view returns (address) {
        if (chainId == ETHEREUM_SEPOLIA) return vm.envAddress("SETTLEMENT_INITIATOR_ETHEREUM_SEPOLIA");
        if (chainId == ARC_TESTNET) return vm.envAddress("SETTLEMENT_INITIATOR_ARC_TESTNET");
        return vm.envAddress("SETTLEMENT_INITIATOR");
    }

    function run() external {
        // Optional: only set when broadcasting with a plaintext key (CI, local
        // anvil runs). Left unset, --account/--sender on the forge CLI supplies
        // the signer instead, so a keystore-cached wallet never needs its key
        // to touch an env var or this script.
        uint256 deployerKey = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0));

        ArcaidiaDeployment.Config memory config = ArcaidiaDeployment.Config({
            owner: vm.envAddress("PROTOCOL_OWNER"),
            settlementAsset: vm.envOr("SETTLEMENT_ASSET", _defaultSettlementAsset(block.chainid)),
            settlementInitiator: _settlementInitiator(block.chainid),
            destinationChainId: vm.envOr("DESTINATION_CHAIN_ID", _defaultDestinationChainId(block.chainid)),
            destinationSettlementReceiver: vm.envAddress("DESTINATION_SETTLEMENT_RECEIVER"),
            reserveFloorBps: uint16(vm.envUint("RESERVE_FLOOR_BPS")),
            treasury: vm.envAddress("PROTOCOL_TREASURY"),
            protocolFeeShareBps: uint16(vm.envUint("PROTOCOL_FEE_SHARE_BPS")),
            maxIntentAmount: vm.envUint("MAX_INTENT_AMOUNT"),
            maxInFlightValue: vm.envUint("MAX_IN_FLIGHT_VALUE"),
            settlementReporter: vm.envAddress("SETTLEMENT_REPORTER")
        });

        require(ARACHNID_FACTORY.code.length > 0, "CREATE2 factory missing on this chain");

        // The address every wiring call inside deployAll will broadcast as —
        // derived from the key when one is given (unambiguous), else from
        // --sender, which forge sets as msg.sender for this whole run before
        // broadcasting even starts.
        address deployingAs = deployerKey != 0 ? vm.addr(deployerKey) : msg.sender;

        if (deployerKey != 0) {
            vm.startBroadcast(deployerKey);
        } else {
            vm.startBroadcast();
        }

        ArcaidiaDeployer deployer = _ensureDeployer();
        ArcaidiaDeployment.Deployment memory predicted = ArcaidiaDeployment.predict(deployer);

        console.log("chain id                ", block.chainid);
        console.log("arcaidia deployer       ", address(deployer));
        console.log("predicted router        ", predicted.router);
        console.log("predicted vault         ", predicted.vault);
        console.log("predicted receiver      ", predicted.settlementReceiver);

        ArcaidiaDeployment.Deployment memory deployment =
            ArcaidiaDeployment.deployAll(deployer, config, deployingAs);

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
