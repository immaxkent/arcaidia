// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ArcaidiaDeployer} from "../src/deploy/ArcaidiaDeployer.sol";
import {ArcaidiaDeployment} from "../src/deploy/ArcaidiaDeployment.sol";
import {CircleCCTPInitiator} from "../src/CircleCCTPInitiator.sol";

/// @notice WP-10: deploys `CircleCCTPInitiator` and the replacement router that
///         uses it, on whichever chain the RPC points at.
///
/// @dev A separate script from `Deploy.s.sol` rather than a flag on it: the
///      vault and settlement receiver this run reuses must already be live
///      (from `Deploy.s.sol`), and mixing "deploy everything" with "deploy just
///      the router" into one script's control flow is more confusing than two
///      scripts that each do one thing. See `ArcaidiaDeployment.deployReplacementRouter`
///      for why the router — and only the router — needs to move.
///
///      Usage (keystore-cached wallet, no plaintext key anywhere):
///        forge script script/DeployCctpRouter.s.sol \
///          --rpc-url $ETHEREUM_SEPOLIA_RPC_URL \
///          --account <cast-wallet-name> --sender <that-account's-address> \
///          --broadcast
contract DeployCctpRouterScript is Script {
    uint256 internal constant ETHEREUM_SEPOLIA = 11155111;
    uint256 internal constant ARC_TESTNET = 5042002;

    /// @dev Real testnet USDC, permanent addresses — same values as Deploy.s.sol.
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

    /// @dev CCTP V2 TokenMessenger — identical address on both chains, verified
    ///      live via eth_getCode 2026-09-04 (packages/domain/src/config/chains.ts).
    function _tokenMessenger(uint256 chainId) internal pure returns (address) {
        if (chainId == ETHEREUM_SEPOLIA || chainId == ARC_TESTNET) {
            return 0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA;
        }
        return address(0);
    }

    /// @dev CCTP domain identifiers. Not derivable from chain id — Circle's own
    ///      allocation, not a formula.
    function _cctpDomain(uint256 chainId) internal pure returns (uint32) {
        if (chainId == ETHEREUM_SEPOLIA) return 0;
        if (chainId == ARC_TESTNET) return 26;
        revert("no CCTP domain configured for this chain");
    }

    function run() external {
        uint256 deployerKey = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0));

        address owner = vm.envAddress("PROTOCOL_OWNER");
        address settlementAsset = vm.envOr("SETTLEMENT_ASSET", _defaultSettlementAsset(block.chainid));
        uint256 destinationChainId = vm.envOr("DESTINATION_CHAIN_ID", _defaultDestinationChainId(block.chainid));
        address destinationSettlementReceiver = vm.envAddress("DESTINATION_SETTLEMENT_RECEIVER");
        uint256 maxIntentAmount = vm.envUint("MAX_INTENT_AMOUNT");
        uint256 maxInFlightValue = vm.envUint("MAX_IN_FLIGHT_VALUE");
        address tokenMessenger = _tokenMessenger(block.chainid);
        require(tokenMessenger != address(0), "no TokenMessengerV2 configured for this chain");

        address deployingAs = deployerKey != 0 ? vm.addr(deployerKey) : msg.sender;

        if (deployerKey != 0) {
            vm.startBroadcast(deployerKey);
        } else {
            vm.startBroadcast();
        }

        ArcaidiaDeployer deployer = ArcaidiaDeployer(_deployerAddress());
        require(address(deployer).code.length > 0, "ArcaidiaDeployer not deployed on this chain yet");

        address predictedRouter = ArcaidiaDeployment.predictReplacementRouter(deployer);
        console.log("chain id                    ", block.chainid);
        console.log("predicted replacement router", predictedRouter);

        CircleCCTPInitiator initiator = new CircleCCTPInitiator(deployingAs, tokenMessenger, settlementAsset);
        initiator.setDomain(destinationChainId, _cctpDomain(destinationChainId));

        address router = ArcaidiaDeployment.deployReplacementRouter(
            deployer,
            ArcaidiaDeployment.RouterConfig({
                settlementInitiator: address(initiator),
                settlementAsset: settlementAsset,
                destinationChainId: destinationChainId,
                destinationSettlementReceiver: destinationSettlementReceiver,
                maxIntentAmount: maxIntentAmount,
                maxInFlightValue: maxInFlightValue,
                owner: owner,
                deployingAs: deployingAs
            })
        );

        initiator.transferOwnership(owner);

        vm.stopBroadcast();

        require(router == predictedRouter, "router address mismatch");

        console.log("--- deployed ---");
        console.log("CircleCCTPInitiator         ", address(initiator));
        console.log("ArcaidiaIntentRouter (CCTP) ", router);
        console.log("owner                       ", owner);
    }

    /// @dev Same derivation as Deploy.s.sol's `_ensureDeployer`, without
    ///      re-deploying it: by this point in WP-10, Deploy.s.sol has already
    ///      run and the deployer is live on both chains.
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
