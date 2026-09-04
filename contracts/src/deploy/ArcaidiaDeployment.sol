// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ArcaidiaDeployer} from "./ArcaidiaDeployer.sol";
import {ArcaidiaIntentRouter} from "../ArcaidiaIntentRouter.sol";
import {ArcaidiaLiquidityVault} from "../ArcaidiaLiquidityVault.sol";
import {SettlementReceiver} from "../SettlementReceiver.sol";

/// @title ArcaidiaDeployment
/// @notice The deployment itself, as a testable library rather than script-only
///         logic.
///
/// @dev A deployment that only exists inside a `forge script` can be verified
///      once, on a live network, with real funds. Putting it here means the same
///      code that will run against Sepolia and Arc is exercised by the test
///      suite in both directions first, including the wiring between contracts —
///      which is where deployments usually go wrong.
///
///      Ownership is taken by the deploying address, used to wire the contracts
///      together, then transferred to the intended owner. Wiring calls are
///      owner-only, so this avoids either weakening those guards or requiring a
///      second signer mid-deployment.
library ArcaidiaDeployment {
    /// @dev Fixed salts. These must be identical on every chain, forever: they
    ///      are half of what determines the addresses. Changing one is a new
    ///      deployment, not an upgrade.
    bytes32 internal constant ROUTER_SALT = keccak256("arcaidia.v1.intent-router");
    bytes32 internal constant VAULT_SALT = keccak256("arcaidia.v1.liquidity-vault");
    bytes32 internal constant RECEIVER_SALT = keccak256("arcaidia.v1.settlement-receiver");

    struct Config {
        /// Final owner, after wiring.
        address owner;
        /// The settlement asset on this chain. MockUSDC or real USDC — a
        /// configuration choice, not a code path.
        address settlementAsset;
        /// Canonical settlement transport on this chain.
        address settlementInitiator;
        /// The chain this router sends to.
        uint256 destinationChainId;
        /// The settlement receiver on the destination chain.
        /// @dev Passed explicitly rather than assumed equal to the local one.
        ///      CREATE2 parity means it will be the same address, but making
        ///      that an implicit dependency would turn a convenience into a
        ///      correctness requirement.
        address destinationSettlementReceiver;
        uint16 reserveFloorBps;
        uint256 maxIntentAmount;
        uint256 maxInFlightValue;
        /// Operator permitted to report canonical settlement.
        address settlementReporter;
    }

    struct Deployment {
        address router;
        address vault;
        address settlementReceiver;
    }

    /// @notice Where the three contracts will land, before deploying anything.
    /// @dev The deployment script prints these and asserts against them, so a
    ///      mismatch is caught before broadcasting rather than after.
    function predict(ArcaidiaDeployer deployer) internal view returns (Deployment memory) {
        return Deployment({
            router: deployer.predictAddress(ROUTER_SALT, keccak256(type(ArcaidiaIntentRouter).creationCode)),
            vault: deployer.predictAddress(VAULT_SALT, keccak256(type(ArcaidiaLiquidityVault).creationCode)),
            settlementReceiver: deployer.predictAddress(
                RECEIVER_SALT, keccak256(type(SettlementReceiver).creationCode)
            )
        });
    }

    /// @notice Deploy and wire the full protocol on the current chain.
    function deployAll(ArcaidiaDeployer deployer, Config memory config)
        internal
        returns (Deployment memory deployment)
    {
        address self = address(this);

        // Take ownership first, wire, then hand over.
        deployment.vault = deployer.deploy(
            VAULT_SALT,
            type(ArcaidiaLiquidityVault).creationCode,
            abi.encodeCall(
                ArcaidiaLiquidityVault.initialize, (self, config.settlementAsset, config.reserveFloorBps)
            )
        );

        deployment.settlementReceiver = deployer.deploy(
            RECEIVER_SALT,
            type(SettlementReceiver).creationCode,
            abi.encodeCall(SettlementReceiver.initialize, (self, config.settlementAsset, deployment.vault))
        );

        deployment.router = deployer.deploy(
            ROUTER_SALT,
            type(ArcaidiaIntentRouter).creationCode,
            abi.encodeCall(
                ArcaidiaIntentRouter.initialize,
                (
                    self,
                    config.settlementAsset,
                    config.settlementInitiator,
                    config.maxIntentAmount,
                    config.maxInFlightValue
                )
            )
        );

        _wire(deployment, config);
        _handOver(deployment, config.owner);
    }

    function _wire(Deployment memory deployment, Config memory config) private {
        // Only the local receiver may reimburse the local vault.
        ArcaidiaLiquidityVault(deployment.vault).setSettlementReceiver(deployment.settlementReceiver);

        if (config.settlementReporter != address(0)) {
            SettlementReceiver(deployment.settlementReceiver).setReporter(config.settlementReporter, true);
        }

        // The router points at the receiver on the *destination* chain.
        ArcaidiaIntentRouter(deployment.router)
            .setDestination(config.destinationChainId, config.destinationSettlementReceiver);
    }

    function _handOver(Deployment memory deployment, address owner) private {
        ArcaidiaLiquidityVault(deployment.vault).transferOwnership(owner);
        SettlementReceiver(deployment.settlementReceiver).transferOwnership(owner);
        ArcaidiaIntentRouter(deployment.router).transferOwnership(owner);
    }
}
