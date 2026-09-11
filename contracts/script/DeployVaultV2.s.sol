// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ArcaidiaDeployer} from "../src/deploy/ArcaidiaDeployer.sol";
import {ArcaidiaDeployment} from "../src/deploy/ArcaidiaDeployment.sol";
import {ArcaidiaIntentRouter} from "../src/ArcaidiaIntentRouter.sol";

/// @notice WP-12: deploys the replacement vault + settlement receiver (live
///         percentage-based fill limits), reuses the existing router, and
///         repoints it at the new receiver — on whichever chain the RPC
///         points at.
///
/// @dev A separate script from `Deploy.s.sol`/`DeployCctpRouter.s.sol`, same
///      reasoning as that one: the router this run reuses must already be
///      live. See `ArcaidiaDeployment.deployReplacementVaultAndReceiver` for
///      why the vault and receiver — and only those two — need to move this
///      time, and why the router doesn't.
///
///      The old vault is left exactly as it is — not paused, not drained by
///      this script. Its own pending intents keep settling normally via
///      canonical CCTP (they were never routed through the new infrastructure
///      to begin with). Existing LPs migrate their own position by hand:
///      `redeem`/`withdraw` from the old vault, `deposit` into this one — the
///      same two calls as any other LP action, not a special migration path.
///
///      Usage (keystore-cached wallet, no plaintext key anywhere):
///        forge script script/DeployVaultV2.s.sol \
///          --rpc-url $ETHEREUM_SEPOLIA_RPC_URL \
///          --account deployKey --sender 0x538e5E9797fa86eE25e97289439b6A3AbA0165b0 \
///          --broadcast
contract DeployVaultV2Script is Script {
    uint256 internal constant ETHEREUM_SEPOLIA = 11155111;
    uint256 internal constant ARC_TESTNET = 5042002;

    /// @dev The live, deployed router — identical on both chains via CREATE2,
    ///      unchanged since WP-10 (2026-09-09) and untouched by this script.
    address internal constant ROUTER = 0x58868465d14e0694d033bD511588AE90482b21CC;

    /// @dev Same values as Deploy.s.sol/DeployCctpRouter.s.sol.
    function _defaultSettlementAsset(uint256 chainId) internal pure returns (address) {
        if (chainId == ETHEREUM_SEPOLIA) return 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
        if (chainId == ARC_TESTNET) return 0x3600000000000000000000000000000000000000;
        return address(0);
    }

    function _defaultDestinationChainId(uint256 chainId) internal pure returns (uint256) {
        if (chainId == ETHEREUM_SEPOLIA) return ARC_TESTNET;
        if (chainId == ARC_TESTNET) return ETHEREUM_SEPOLIA;
        return 0;
    }

    function run() external {
        address owner = vm.envAddress("PROTOCOL_OWNER");
        address settlementAsset = vm.envOr("SETTLEMENT_ASSET", _defaultSettlementAsset(block.chainid));
        uint256 destinationChainId =
            vm.envOr("DESTINATION_CHAIN_ID", _defaultDestinationChainId(block.chainid));
        uint16 reserveFloorBps = uint16(vm.envUint("RESERVE_FLOOR_BPS"));
        address treasury = vm.envOr("PROTOCOL_TREASURY", address(0));
        uint16 protocolFeeShareBps = uint16(vm.envOr("PROTOCOL_FEE_SHARE_BPS", uint256(0)));
        address solverSigner = vm.envOr("SOLVER_SIGNER_ADDRESS", address(0));
        address settlementReporter = vm.envOr("SETTLEMENT_REPORTER_ADDRESS", address(0));

        vm.startBroadcast();

        ArcaidiaDeployer deployer = ArcaidiaDeployer(_deployerAddress());
        require(address(deployer).code.length > 0, "ArcaidiaDeployer not deployed on this chain yet");

        ArcaidiaDeployment.VaultV2Deployment memory predicted =
            ArcaidiaDeployment.predictReplacementVaultAndReceiver(deployer);
        console.log("chain id                     ", block.chainid);
        console.log("predicted vault              ", predicted.vault);
        console.log("predicted settlement receiver", predicted.settlementReceiver);
        console.log("predicted intent market      ", predicted.market);
        console.log("solver signer to authorise   ", solverSigner);
        console.log("settlement reporter to grant ", settlementReporter);

        ArcaidiaDeployment.VaultV2Deployment memory deployment =
            ArcaidiaDeployment.deployReplacementVaultAndReceiver(
                deployer,
                ArcaidiaDeployment.VaultV2Config({
                    settlementAsset: settlementAsset,
                    reserveFloorBps: reserveFloorBps,
                    treasury: treasury,
                    protocolFeeShareBps: protocolFeeShareBps,
                    solverSigner: solverSigner,
                    settlementReporter: settlementReporter,
                    owner: owner,
                    deployingAs: msg.sender
                })
            );

        // The router is untouched (WP-12 only replaces the vault + receiver),
        // but it must send this chain's canonical CCTP mint recipient at the
        // *new* receiver on the destination chain going forward.
        ArcaidiaIntentRouter(ROUTER).setDestination(destinationChainId, deployment.settlementReceiver);

        vm.stopBroadcast();

        require(deployment.vault == predicted.vault, "vault address mismatch");
        require(
            deployment.settlementReceiver == predicted.settlementReceiver,
            "settlement receiver address mismatch"
        );
        require(deployment.market == predicted.market, "intent market address mismatch");

        console.log("--- deployed ---");
        console.log("ArcaidiaLiquidityVault (v2)  ", deployment.vault);
        console.log("SettlementReceiver (v2)      ", deployment.settlementReceiver);
        console.log("ArcaidiaIntentMarket (v2)    ", deployment.market);
        console.log("router repointed to          ", deployment.settlementReceiver);
        console.log("owner                        ", owner);
    }

    /// @dev Same derivation as Deploy.s.sol/DeployCctpRouter.s.sol.
    function _deployerAddress() internal pure returns (address) {
        address arachnidFactory = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
        bytes32 deployerSalt = keccak256("arcaidia.v1.deployer");
        bytes memory creationCode = type(ArcaidiaDeployer).creationCode;
        return address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(bytes1(0xff), arachnidFactory, deployerSalt, keccak256(creationCode))
                    )
                )
            )
        );
    }
}
