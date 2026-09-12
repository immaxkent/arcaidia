// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ArcaidiaDeployer} from "../src/deploy/ArcaidiaDeployer.sol";
import {ArcaidiaIntentRouter} from "../src/ArcaidiaIntentRouter.sol";
import {ArcaidiaLiquidityVault} from "../src/ArcaidiaLiquidityVault.sol";
import {SettlementReceiver} from "../src/SettlementReceiver.sol";

/// @title RedeployReceiver — the v2.1 SettlementReceiver, alone (D12)
/// @notice The v2.0 receiver (`arcaidia.v2.settlement-receiver`, 0x8B93…20Cd) required a CCTP
///         message's header `recipient` to be itself; on a real network that field is Circle's
///         TokenMessenger, so `settleWithProof` refused every genuine message. Only the receiver
///         needs replacing: the router's destination map and each vault's `settlementReceiver`
///         are owner-settable, and the market's immutable settlement check merely reads an
///         "already settled" flag the old receiver will now never set.
///
///         Runs per chain, as the protocol owner:
///           1. CREATE2 the fixed receiver at a new salt (same address on both chains);
///           2. initialise it against the *existing* market and Circle's MessageTransmitter;
///           3. allow the settlement reporter (recovery path) and hand ownership over;
///           4. point this chain's router at the other chain's (identical) new receiver;
///           5. point the House Vault at it.
///         Independent operators point their own vaults at it from the console (owner call).
///
///           forge script script/RedeployReceiver.s.sol --rpc-url $ETHEREUM_SEPOLIA_RPC_URL \
///             --account deployKey --sender $PROTOCOL_OWNER --broadcast --slow
contract RedeployReceiver is Script {
    address internal constant ARACHNID_FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    bytes32 internal constant DEPLOYER_SALT = keccak256("arcaidia.v1.deployer");
    bytes32 internal constant RECEIVER_SALT_R2 = keccak256("arcaidia.v2.settlement-receiver.r2");

    uint256 internal constant ETHEREUM_SEPOLIA = 11155111;
    uint256 internal constant ARC_TESTNET = 5042002;

    address internal constant CCTP_V2_MESSAGE_TRANSMITTER = 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275;
    address internal constant V2_MARKET = 0x81d94f5149FC86df7A273A720070300C461DcA08;
    address internal constant V2_ROUTER = 0x69946FFBBE5f250C7357b89E4072F9eAfc1c3ee6;
    address internal constant V2_HOUSE_VAULT = 0xB4bA190D5C78869366e7963f5CcCf4c3167d855C;

    function run() external {
        require(ARACHNID_FACTORY.code.length > 0, "CREATE2 factory missing on this chain");
        ArcaidiaDeployer deployer = _existingDeployer();
        address owner = vm.envAddress("PROTOCOL_OWNER");
        address reporter = vm.envAddress("SETTLEMENT_REPORTER");
        address asset = vm.envOr("SETTLEMENT_ASSET", _defaultSettlementAsset(block.chainid));
        address market = vm.envOr("INTENT_MARKET", V2_MARKET);
        address router = vm.envOr("INTENT_ROUTER", V2_ROUTER);
        address houseVault = vm.envOr("HOUSE_VAULT", V2_HOUSE_VAULT);
        uint256 destinationChainId = vm.envOr("DESTINATION_CHAIN_ID", _defaultDestinationChainId(block.chainid));

        bytes memory creationCode = type(SettlementReceiver).creationCode;
        address predicted = deployer.predictAddress(RECEIVER_SALT_R2, keccak256(creationCode));
        console.log("chain", block.chainid);
        console.log("predicted receiver (r2)", predicted);

        vm.startBroadcast();
        address deployingAs = msg.sender;
        address receiver = deployer.deploy(RECEIVER_SALT_R2, creationCode, "");
        require(receiver == predicted, "receiver landed at an unexpected address");

        SettlementReceiver r = SettlementReceiver(receiver);
        r.initialize(deployingAs, asset, market, CCTP_V2_MESSAGE_TRANSMITTER);
        r.setReporter(reporter, true);
        if (owner != deployingAs) r.transferOwnership(owner);

        // Same address on the other chain (same deployer, salt and init code), so the router on
        // this chain names it as the destination receiver for burns headed there.
        ArcaidiaIntentRouter(router).setDestination(destinationChainId, receiver);
        ArcaidiaLiquidityVault(houseVault).setSettlementReceiver(receiver);
        vm.stopBroadcast();

        console.log("receiver (r2)          ", receiver);
        console.log("router destination     ", destinationChainId, "->", receiver);
        console.log("house vault receiver   ", receiver);
        console.log("reporter allowed       ", reporter);
    }

    function _existingDeployer() internal view returns (ArcaidiaDeployer) {
        bytes memory creationCode = type(ArcaidiaDeployer).creationCode;
        address predicted = address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), ARACHNID_FACTORY, DEPLOYER_SALT, keccak256(creationCode)))))
        );
        require(predicted.code.length > 0, "ArcaidiaDeployer not deployed on this chain");
        return ArcaidiaDeployer(predicted);
    }

    function _defaultSettlementAsset(uint256 chainId) internal pure returns (address) {
        if (chainId == ETHEREUM_SEPOLIA) return 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
        if (chainId == ARC_TESTNET) return 0x3600000000000000000000000000000000000000;
        revert("no default settlement asset for this chain");
    }

    function _defaultDestinationChainId(uint256 chainId) internal pure returns (uint256) {
        if (chainId == ETHEREUM_SEPOLIA) return ARC_TESTNET;
        if (chainId == ARC_TESTNET) return ETHEREUM_SEPOLIA;
        revert("no default destination for this chain");
    }
}
