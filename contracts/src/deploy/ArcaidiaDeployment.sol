// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ArcaidiaDeployer} from "./ArcaidiaDeployer.sol";
import {ArcaidiaIntentRouter} from "../ArcaidiaIntentRouter.sol";
import {ArcaidiaLiquidityVault} from "../ArcaidiaLiquidityVault.sol";
import {ArcaidiaVaultFactory} from "../ArcaidiaVaultFactory.sol";
import {SettlementReceiver} from "../SettlementReceiver.sol";
import {ArcaidiaIntentMarket} from "../ArcaidiaIntentMarket.sol";
import {ISettlementCheck} from "../interfaces/ISettlementCheck.sol";
import {IVaultRegistry} from "../interfaces/IVaultRegistry.sol";
import {FeePolicy} from "../libraries/ArcaidiaTypes.sol";

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
///
///      **v2 (WP-26).** One protocol deployment is five contracts — router, settlement
///      receiver, market, vault factory, and the House Vault created *through* that
///      factory like any other participant's (D10) — at `arcaidia.v2.*` salts. The v1
///      salts (`arcaidia.v1.intent-router`, `.liquidity-vault`, `.settlement-receiver`,
///      `.intent-router.cctp`, `.liquidity-vault.v2`, `.settlement-receiver.v2`,
///      `.intent-market.v2`) are history: they name the retired contracts recorded in
///      `packages/domain/src/config/deployments.ts` and are never reused.
library ArcaidiaDeployment {
    /// @dev Fixed salts. These must be identical on every chain, forever: they
    ///      are half of what determines the addresses. Changing one is a new
    ///      deployment, not an upgrade.
    bytes32 internal constant ROUTER_SALT = keccak256("arcaidia.v2.intent-router");
    bytes32 internal constant RECEIVER_SALT = keccak256("arcaidia.v2.settlement-receiver");
    bytes32 internal constant MARKET_SALT = keccak256("arcaidia.v2.intent-market");
    bytes32 internal constant FACTORY_SALT = keccak256("arcaidia.v2.vault-factory");
    /// @dev The House Vault's creator salt at the factory; its address also depends on the
    ///      creating address (`Config.deployingAs`), which must therefore be the same on both
    ///      chains for parity — true for the protocol deployer key.
    bytes32 internal constant HOUSE_VAULT_SALT = keccak256("arcaidia.v2.house-vault");

    /// @dev WP-10 history: the replacement CCTP router's salt, kept only so
    ///      `deployReplacementRouter` (DeployCctpRouter.s.sol) still describes what was run.
    bytes32 internal constant ROUTER_CCTP_SALT = keccak256("arcaidia.v1.intent-router.cctp");

    struct Config {
        /// Final owner, after wiring.
        address owner;
        /// The settlement asset on this chain. MockUSDC or real USDC — a
        /// configuration choice, not a code path.
        address settlementAsset;
        /// Canonical settlement transport on this chain (the router's initiator).
        address settlementInitiator;
        /// Circle's `MessageTransmitterV2` on this chain — what `settleWithProof` receives through.
        address messageTransmitter;
        /// The chain this router sends to.
        uint256 destinationChainId;
        /// The settlement receiver on the destination chain.
        /// @dev Passed explicitly rather than assumed equal to the local one.
        ///      CREATE2 parity means it will be the same address, but making
        ///      that an implicit dependency would turn a convenience into a
        ///      correctness requirement.
        address destinationSettlementReceiver;
        uint16 reserveFloorBps;
        uint16 maxFillBps;
        uint16 maxExposureBps;
        /// The House Vault's fee policy — immutable once created (D7).
        FeePolicy feePolicy;
        string houseVaultLabel;
        /// Where protocol fees are swept.
        address treasury;
        /// The protocol's share of each execution fee, in basis points.
        uint16 protocolFeeShareBps;
        uint256 maxIntentAmount;
        uint256 maxInFlightValue;
        /// Operator permitted to report canonical settlement through the recovery path.
        address settlementReporter;
    }

    struct Deployment {
        address router;
        address vault;
        address settlementReceiver;
        address market;
        address factory;
    }

    /// @notice Where the five contracts will land, before deploying anything.
    /// @param deployingAs The address that will call `factory.createVault` for the House Vault.
    function predict(ArcaidiaDeployer deployer, address deployingAs) internal view returns (Deployment memory) {
        address predictedReceiver =
            deployer.predictAddress(RECEIVER_SALT, keccak256(type(SettlementReceiver).creationCode));
        address predictedFactory =
            deployer.predictAddress(FACTORY_SALT, keccak256(type(ArcaidiaVaultFactory).creationCode));

        return Deployment({
            router: deployer.predictAddress(ROUTER_SALT, keccak256(type(ArcaidiaIntentRouter).creationCode)),
            vault: _predictHouseVault(predictedFactory, deployingAs),
            settlementReceiver: predictedReceiver,
            market: deployer.predictAddress(
                MARKET_SALT, keccak256(_marketCreationCode(predictedReceiver, predictedFactory))
            ),
            factory: predictedFactory
        });
    }

    /// @notice Deploy and wire the full protocol on the current chain.
    /// @param deployingAs The address that will appear as `msg.sender` to the
    ///        deployed contracts for the wiring calls below, so it can hold
    ///        temporary ownership just long enough to wire them before
    ///        `_handOver` transfers it to `config.owner`.
    /// @dev Deliberately explicit rather than inferred: this function is
    ///      inlined into whatever calls it (a library's internal functions
    ///      are never a separate call frame), so neither `address(this)` nor
    ///      `msg.sender` reliably names "whoever the wiring calls below will
    ///      appear to come from" — that depends on the CALLER's own context
    ///      (a test contract making plain calls sees itself; a `forge script`
    ///      under `vm.startBroadcast()` has every top-level call re-attributed
    ///      to the broadcaster). Only the caller knows which applies, so the
    ///      caller states it: `address(this)` from a test, `msg.sender` from
    ///      `DeployScript.run()` (which post-`--sender` already equals the
    ///      broadcaster before broadcasting even starts).
    function deployAll(ArcaidiaDeployer deployer, Config memory config, address deployingAs)
        internal
        returns (Deployment memory deployment)
    {
        address self = deployingAs;

        // The receiver's init code takes no constructor arguments, so its address is fixed the
        // instant it's deployed — deployed here without initializing yet, since `initialize`
        // needs the market's address, and the market needs the receiver's and the factory's.
        deployment.settlementReceiver =
            deployer.deploy(RECEIVER_SALT, type(SettlementReceiver).creationCode, "");

        address predictedFactory =
            deployer.predictAddress(FACTORY_SALT, keccak256(type(ArcaidiaVaultFactory).creationCode));

        deployment.market = deployer.deploy(
            MARKET_SALT, _marketCreationCode(deployment.settlementReceiver, predictedFactory), ""
        );

        SettlementReceiver(deployment.settlementReceiver).initialize(
            self, config.settlementAsset, deployment.market, config.messageTransmitter
        );

        deployment.factory = deployer.deploy(
            FACTORY_SALT,
            type(ArcaidiaVaultFactory).creationCode,
            abi.encodeCall(
                ArcaidiaVaultFactory.initialize,
                (self, config.settlementAsset, deployment.market, deployment.settlementReceiver)
            )
        );
        require(deployment.factory == predictedFactory, "factory landed off its prediction");

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

        // The House Vault goes through the same permissionless path as any participant's (D10):
        // created by `self`, wired by the factory, owned by `self` until hand-over.
        deployment.vault = ArcaidiaVaultFactory(deployment.factory)
            .createVault(
                HOUSE_VAULT_SALT,
                config.reserveFloorBps,
                config.maxFillBps,
                config.maxExposureBps,
                config.feePolicy,
                config.houseVaultLabel
            );

        _wire(deployment, config);
        _handOver(deployment, config.owner);
    }

    function _wire(Deployment memory deployment, Config memory config) private {
        if (config.treasury != address(0)) {
            ArcaidiaLiquidityVault(deployment.vault).setTreasury(config.treasury);
            ArcaidiaLiquidityVault(deployment.vault).setProtocolFeeShareBps(config.protocolFeeShareBps);
        }

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
        ArcaidiaVaultFactory(deployment.factory).transferOwnership(owner);
    }

    /// @dev The market's constructor binds the receiver and the factory. Both are CREATE2'd from
    ///      this same deployer with no constructor arguments of their own — identical on every
    ///      chain by construction — so baking them into the market's init code keeps its address
    ///      identical too.
    function _marketCreationCode(address receiver, address factory) private pure returns (bytes memory) {
        return abi.encodePacked(
            type(ArcaidiaIntentMarket).creationCode,
            abi.encode(ISettlementCheck(receiver), IVaultRegistry(factory))
        );
    }

    /// @dev Mirrors `ArcaidiaVaultFactory.predictVault` without needing the factory deployed.
    function _predictHouseVault(address factory, address creator) private pure returns (address) {
        return address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            bytes1(0xff),
                            factory,
                            keccak256(abi.encode(creator, HOUSE_VAULT_SALT)),
                            keccak256(type(ArcaidiaLiquidityVault).creationCode)
                        )
                    )
                )
            )
        );
    }

    // -----------------------------------------------------------------------
    // WP-10 history: replacement router
    // -----------------------------------------------------------------------

    /// @notice Where the replacement router will land, before deploying it.
    function predictReplacementRouter(ArcaidiaDeployer deployer) internal view returns (address) {
        return deployer.predictAddress(ROUTER_CCTP_SALT, keccak256(type(ArcaidiaIntentRouter).creationCode));
    }

    /// @dev Bundled rather than passed as loose parameters: `forge script`'s
    ///      `run()` builds enough other locals (env reads, the deployer, the
    ///      freshly deployed initiator) that adding eight more scalar
    ///      parameters here overflows EVM stack depth without `via_ir`, which
    ///      this project deliberately does not enable. One struct-typed local
    ///      is one stack slot, matching how `Config` avoids the same problem
    ///      in `deployAll` above.
    struct RouterConfig {
        address settlementInitiator;
        address settlementAsset;
        uint256 destinationChainId;
        address destinationSettlementReceiver;
        uint256 maxIntentAmount;
        uint256 maxInFlightValue;
        address owner;
        address deployingAs;
    }

    /// @notice Deploy a replacement router wired to a new settlement initiator
    ///         (WP-10), reusing the vault and settlement receiver already live
    ///         on this chain.
    /// @dev The vault and receiver are untouched: neither stores or checks a
    ///      router address — the vault's authorised-signer fills and the
    ///      receiver's allowlisted-reporter settlement are both independent of
    ///      which router exists — so nothing about them needs to move for the
    ///      router to change.
    function deployReplacementRouter(ArcaidiaDeployer deployer, RouterConfig memory config)
        internal
        returns (address router)
    {
        router = deployer.deploy(
            ROUTER_CCTP_SALT,
            type(ArcaidiaIntentRouter).creationCode,
            abi.encodeCall(
                ArcaidiaIntentRouter.initialize,
                (
                    config.deployingAs,
                    config.settlementAsset,
                    config.settlementInitiator,
                    config.maxIntentAmount,
                    config.maxInFlightValue
                )
            )
        );

        ArcaidiaIntentRouter(router)
            .setDestination(config.destinationChainId, config.destinationSettlementReceiver);
        ArcaidiaIntentRouter(router).transferOwnership(config.owner);
    }
}
