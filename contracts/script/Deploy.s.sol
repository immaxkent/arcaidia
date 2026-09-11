// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ArcaidiaDeployer} from "../src/deploy/ArcaidiaDeployer.sol";
import {ArcaidiaDeployment} from "../src/deploy/ArcaidiaDeployment.sol";
import {ArcaidiaLiquidityVault} from "../src/ArcaidiaLiquidityVault.sol";
import {CircleCCTPInitiator} from "../src/CircleCCTPInitiator.sol";
import {FeePolicy} from "../src/libraries/ArcaidiaTypes.sol";

/// @notice Deploys Arcaidia v2 to whichever chain the RPC points at (WP-31).
///
/// @dev One run per chain, five CREATE2 protocol contracts at identical addresses on both, plus
///      this chain's own `CircleCCTPInitiator` v2 (plain `new` — it takes chain-specific
///      constructor args, so it is not expected to share an address; WP-10 precedent). The
///      initiator is deployed here unless `SETTLEMENT_INITIATOR_<CHAIN>` names one: the live v1
///      initiators cannot serve the v2 router (`initiateSettlement` gained `hookData`, D8).
///      `DESTINATION_SETTLEMENT_RECEIVER` defaults to this chain's own predicted receiver — CREATE2
///      parity makes it the other chain's too — and the House solver signer is authorised in the
///      same run when the protocol owner is the broadcasting key.
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
        if (chainId == ETHEREUM_SEPOLIA) return vm.envOr("SETTLEMENT_INITIATOR_ETHEREUM_SEPOLIA", address(0));
        if (chainId == ARC_TESTNET) return vm.envOr("SETTLEMENT_INITIATOR_ARC_TESTNET", address(0));
        return vm.envOr("SETTLEMENT_INITIATOR", address(0));
    }

    /// @dev Circle's CCTP V2 `TokenMessengerV2` — identical on both testnets (DeployCctpRouter.s.sol).
    address internal constant CCTP_V2_TOKEN_MESSENGER = 0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA;

    function _cctpDomain(uint256 chainId) internal pure returns (uint32) {
        if (chainId == ETHEREUM_SEPOLIA) return 0;
        if (chainId == ARC_TESTNET) return 26;
        revert("no CCTP domain configured for this chain");
    }

    /// @dev A fresh v2 initiator for this chain, owned by the broadcaster until hand-over, pointed at
    ///      the opposite chain's CCTP domain. Skipped (address reused) when the env names one.
    function _ensureInitiator(address deployingAs, address settlementAsset, uint256 destinationChainId)
        internal
        returns (address initiator, bool deployedHere)
    {
        address configured = _settlementInitiator(block.chainid);
        if (configured != address(0)) return (configured, false);
        CircleCCTPInitiator fresh = new CircleCCTPInitiator(deployingAs, CCTP_V2_TOKEN_MESSENGER, settlementAsset);
        fresh.setDomain(destinationChainId, _cctpDomain(destinationChainId));
        return (address(fresh), true);
    }

    function _config(address initiator, address predictedReceiver) internal view returns (ArcaidiaDeployment.Config memory) {
        return ArcaidiaDeployment.Config({
            owner: vm.envAddress("PROTOCOL_OWNER"),
            settlementAsset: vm.envOr("SETTLEMENT_ASSET", _defaultSettlementAsset(block.chainid)),
            settlementInitiator: initiator,
            messageTransmitter: vm.envOr("MESSAGE_TRANSMITTER", CCTP_V2_MESSAGE_TRANSMITTER),
            destinationChainId: vm.envOr("DESTINATION_CHAIN_ID", _defaultDestinationChainId(block.chainid)),
            destinationSettlementReceiver: vm.envOr("DESTINATION_SETTLEMENT_RECEIVER", predictedReceiver),
            reserveFloorBps: uint16(vm.envUint("RESERVE_FLOOR_BPS")),
            maxFillBps: uint16(vm.envOr("MAX_FILL_BPS", uint256(5_000))),
            maxExposureBps: uint16(vm.envOr("MAX_EXPOSURE_BPS", uint256(8_000))),
            feePolicy: _feePolicyFromEnv(),
            houseVaultLabel: vm.envOr("HOUSE_VAULT_LABEL", string("Arcaidia House Vault")),
            treasury: vm.envAddress("PROTOCOL_TREASURY"),
            protocolFeeShareBps: uint16(vm.envUint("PROTOCOL_FEE_SHARE_BPS")),
            maxIntentAmount: vm.envUint("MAX_INTENT_AMOUNT"),
            maxInFlightValue: vm.envUint("MAX_IN_FLIGHT_VALUE"),
            settlementReporter: vm.envAddress("SETTLEMENT_REPORTER")
        });
    }

    /// @dev Circle's CCTP V2 `MessageTransmitterV2` — identical on Ethereum Sepolia and Arc
    ///      testnet (packages/domain/src/config/chains.ts, verified live 2026-09-04).
    address internal constant CCTP_V2_MESSAGE_TRANSMITTER = 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275;

    /// @dev The House Vault's fee tiers (D7). Defaults are the plan's proposal for the House
    ///      Vault: 10/25/60/120 bps at 50/75/90% utilisation.
    function _feePolicyFromEnv() internal view returns (FeePolicy memory) {
        return FeePolicy({
            baseFeeBps: uint16(vm.envOr("FEE_BASE_BPS", uint256(10))),
            midFeeBps: uint16(vm.envOr("FEE_MID_BPS", uint256(25))),
            highFeeBps: uint16(vm.envOr("FEE_HIGH_BPS", uint256(60))),
            criticalFeeBps: uint16(vm.envOr("FEE_CRITICAL_BPS", uint256(120))),
            midThresholdBps: uint16(vm.envOr("FEE_MID_THRESHOLD_BPS", uint256(5_000))),
            highThresholdBps: uint16(vm.envOr("FEE_HIGH_THRESHOLD_BPS", uint256(7_500))),
            criticalThresholdBps: uint16(vm.envOr("FEE_CRITICAL_THRESHOLD_BPS", uint256(9_000)))
        });
    }

    function run() external {
        // Optional: only set when broadcasting with a plaintext key (CI, local
        // anvil runs). Left unset, --account/--sender on the forge CLI supplies
        // the signer instead, so a keystore-cached wallet never needs its key
        // to touch an env var or this script.
        uint256 deployerKey = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0));
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
        ArcaidiaDeployment.Deployment memory predicted = ArcaidiaDeployment.predict(deployer, deployingAs);
        _logPredicted(deployer, predicted);

        address settlementAsset = vm.envOr("SETTLEMENT_ASSET", _defaultSettlementAsset(block.chainid));
        uint256 destinationChainId = vm.envOr("DESTINATION_CHAIN_ID", _defaultDestinationChainId(block.chainid));
        (address initiator, bool initiatorDeployedHere) = _ensureInitiator(deployingAs, settlementAsset, destinationChainId);

        ArcaidiaDeployment.Config memory config = _config(initiator, predicted.settlementReceiver);
        // Found in the WP-31 dry run: a stale DESTINATION_SETTLEMENT_RECEIVER in .env pointed the v2
        // routers at the *retired* 2026-09-08 receiver — every canonical mint would have landed on
        // a dead contract. CREATE2 parity means the right answer is always this chain's own
        // predicted receiver; anything else must be an explicit, named decision.
        require(
            config.destinationSettlementReceiver == predicted.settlementReceiver
                || vm.envOr("ALLOW_FOREIGN_DESTINATION_RECEIVER", false),
            "DESTINATION_SETTLEMENT_RECEIVER is not the predicted v2 receiver; unset it (parity) or set ALLOW_FOREIGN_DESTINATION_RECEIVER=true"
        );
        ArcaidiaDeployment.Deployment memory deployment = ArcaidiaDeployment.deployAll(deployer, config, deployingAs);

        _postDeploy(deployment, config, deployingAs, initiator, initiatorDeployedHere);

        vm.stopBroadcast();

        // Asserted after broadcasting as well as inside the deployer, because
        // this is the WP-01 acceptance criterion and it should fail loudly.
        require(deployment.router == predicted.router, "router address mismatch");
        require(deployment.vault == predicted.vault, "vault address mismatch");
        require(deployment.settlementReceiver == predicted.settlementReceiver, "receiver address mismatch");
        require(deployment.market == predicted.market, "market address mismatch");
        require(deployment.factory == predicted.factory, "factory address mismatch");

        _logDeployed(deployment, config, initiator);
    }

    /// @dev Everything after the five protocol contracts exist, still under the broadcaster's key:
    ///      the initiator's ownership goes to the protocol owner, and — when the owner *is* the
    ///      broadcaster, the case on both testnets — the House solver signer is authorised right
    ///      here so the vault is fillable the moment the run ends (WP-12's lesson: a vault with no
    ///      authorised signer reverts every fill and looks, from outside, merely quiet).
    function _postDeploy(
        ArcaidiaDeployment.Deployment memory deployment,
        ArcaidiaDeployment.Config memory config,
        address deployingAs,
        address initiator,
        bool initiatorDeployedHere
    ) internal {
        if (initiatorDeployedHere && config.owner != deployingAs) {
            CircleCCTPInitiator(initiator).transferOwnership(config.owner);
        }
        address signer = vm.envOr("SOLVER_SIGNER_ADDRESS", vm.envOr("CIRCLE_AGENT_WALLET_ADDRESS", address(0)));
        if (signer != address(0)) {
            if (config.owner == deployingAs) {
                ArcaidiaLiquidityVault(deployment.vault).setAuthorisedSigner(signer, true);
                console.log("house solver signer authorised", signer);
            } else {
                console.log("NOTE: owner != broadcaster; run AuthorizeSolverSigner.s.sol as the owner for", signer);
            }
        } else {
            console.log("NOTE: no SOLVER_SIGNER_ADDRESS / CIRCLE_AGENT_WALLET_ADDRESS set; House Vault has no signer yet");
        }
    }

    function _logPredicted(ArcaidiaDeployer deployer, ArcaidiaDeployment.Deployment memory predicted) internal view {
        console.log("chain id                ", block.chainid);
        console.log("arcaidia deployer       ", address(deployer));
        console.log("predicted router        ", predicted.router);
        console.log("predicted vault         ", predicted.vault);
        console.log("predicted receiver      ", predicted.settlementReceiver);
        console.log("predicted market        ", predicted.market);
        console.log("predicted vault factory ", predicted.factory);
    }

    function _logDeployed(
        ArcaidiaDeployment.Deployment memory deployment,
        ArcaidiaDeployment.Config memory config,
        address initiator
    ) internal view {
        console.log("--- deployed ---");
        console.log("CircleCCTPInitiator (v2)", initiator);
        console.log("ArcaidiaIntentRouter    ", deployment.router);
        console.log("ArcaidiaLiquidityVault  ", deployment.vault);
        console.log("SettlementReceiver      ", deployment.settlementReceiver);
        console.log("ArcaidiaIntentMarket    ", deployment.market);
        console.log("ArcaidiaVaultFactory    ", deployment.factory);
        console.log("destination receiver    ", config.destinationSettlementReceiver);
        console.log("settlement reporter     ", config.settlementReporter);
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
