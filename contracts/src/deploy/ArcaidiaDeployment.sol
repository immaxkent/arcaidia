// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ArcaidiaDeployer} from "./ArcaidiaDeployer.sol";
import {ArcaidiaIntentRouter} from "../ArcaidiaIntentRouter.sol";
import {ArcaidiaLiquidityVault} from "../ArcaidiaLiquidityVault.sol";
import {SettlementReceiver} from "../SettlementReceiver.sol";
import {ArcaidiaIntentMarket} from "../ArcaidiaIntentMarket.sol";
import {ISettlementCheck} from "../interfaces/ISettlementCheck.sol";

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

    /// @dev WP-16 (intent market): added after the real v1.0.0 addresses (router/vault/receiver
    ///      at the three salts above) were already frozen and recorded in README.md — this salt
    ///      never existed in the historical deployment, so `deployAll` deploying a market now
    ///      does not change or reproduce that frozen history, it only extends what a *fresh*
    ///      from-scratch deploy on this branch does going forward. Same constructor-arg CREATE2
    ///      safety note as `MARKET_V2_SALT` below: the receiver address baked into the market's
    ///      init code is itself identical across chains by construction.
    bytes32 internal constant MARKET_SALT = keccak256("arcaidia.v1.intent-market");

    /// @dev WP-10: the original router (`ROUTER_SALT`) was initialized against
    ///      `MockSettlementInitiator`, and `settlementInitiator` is fixed at
    ///      `initialize()` with no setter — this contract has no upgrade path.
    ///      Swapping in `CircleCCTPInitiator` therefore means a *new* router at
    ///      a new salt, deployed by `deployReplacementRouter` below, not a
    ///      change to the one at `ROUTER_SALT`. Distinct from that salt forever,
    ///      for the same reason the others above must never change.
    bytes32 internal constant ROUTER_CCTP_SALT = keccak256("arcaidia.v1.intent-router.cctp");

    /// @dev WP-25: the v1.1-schema router (`createIntent` gains `tokenOut`/`targetMinOut`,
    ///      `IntentCreated` v2, intent hook through the initiator) — new ABI, new event, new
    ///      init code, so a new salt. Deployed by `deployAllV2` (WP-26), never by `deployAll`.
    bytes32 internal constant ROUTER_V2_SALT = keccak256("arcaidia.v2.intent-router");

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
        /// Where protocol fees are swept.
        address treasury;
        /// The protocol's share of each execution fee, in basis points.
        uint16 protocolFeeShareBps;
        uint256 maxIntentAmount;
        uint256 maxInFlightValue;
        /// Operator permitted to report canonical settlement.
        address settlementReporter;
    }

    struct Deployment {
        address router;
        address vault;
        address settlementReceiver;
        address market;
    }

    /// @notice Where the four contracts will land, before deploying anything.
    /// @dev The deployment script prints these and asserts against them, so a
    ///      mismatch is caught before broadcasting rather than after.
    function predict(ArcaidiaDeployer deployer) internal view returns (Deployment memory) {
        address predictedReceiver = deployer.predictAddress(
            RECEIVER_SALT, keccak256(type(SettlementReceiver).creationCode)
        );

        return Deployment({
            router: deployer.predictAddress(ROUTER_SALT, keccak256(type(ArcaidiaIntentRouter).creationCode)),
            vault: deployer.predictAddress(VAULT_SALT, keccak256(type(ArcaidiaLiquidityVault).creationCode)),
            settlementReceiver: predictedReceiver,
            market: deployer.predictAddress(
                MARKET_SALT,
                keccak256(
                    abi.encodePacked(
                        type(ArcaidiaIntentMarket).creationCode,
                        abi.encode(ISettlementCheck(predictedReceiver))
                    )
                )
            )
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

        // Take ownership first, wire, then hand over.
        deployment.vault = deployer.deploy(
            VAULT_SALT,
            type(ArcaidiaLiquidityVault).creationCode,
            abi.encodeCall(
                ArcaidiaLiquidityVault.initialize, (self, config.settlementAsset, config.reserveFloorBps)
            )
        );

        // The receiver's init code takes no constructor arguments, so its address is fixed the
        // instant it's deployed — deployed here without initializing yet, since `initialize` now
        // needs the market's address, and the market needs the receiver's.
        deployment.settlementReceiver =
            deployer.deploy(RECEIVER_SALT, type(SettlementReceiver).creationCode, "");

        deployment.market = deployer.deploy(
            MARKET_SALT,
            abi.encodePacked(
                type(ArcaidiaIntentMarket).creationCode,
                abi.encode(ISettlementCheck(deployment.settlementReceiver))
            ),
            ""
        );

        SettlementReceiver(deployment.settlementReceiver).initialize(
            self, config.settlementAsset, deployment.market
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
        ArcaidiaLiquidityVault(deployment.vault).setMarket(deployment.market);

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
    }

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
    ///      router to change. `destinationSettlementReceiver` is passed
    ///      explicitly rather than assumed equal to the existing receiver's own
    ///      address for the same reason `deployAll` does: CREATE2 parity means
    ///      they are equal in practice, but that should never be an implicit
    ///      dependency.
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

    /// @dev WP-12: `maxFillBps`/`maxExposureBps`/`maxFeeBps` were added to
    ///      `ArcaidiaLiquidityVault`, replacing flat absolutes — new storage
    ///      layout, same "no upgrade path" reasoning as `ROUTER_CCTP_SALT`
    ///      above, so this is a new vault (and, since `SettlementReceiver.vault`
    ///      is fixed at `initialize()` with no setter, a new receiver too) at
    ///      new salts, not a change to the ones at `VAULT_SALT`/`RECEIVER_SALT`.
    bytes32 internal constant VAULT_V2_SALT = keccak256("arcaidia.v1.liquidity-vault.v2");
    bytes32 internal constant RECEIVER_V2_SALT = keccak256("arcaidia.v1.settlement-receiver.v2");

    /// @dev WP-16 (intent market): `ArcaidiaIntentMarket`'s constructor takes the settlement
    ///      receiver's address as an argument, which would ordinarily be exactly the
    ///      chain-specific-constructor-argument trap `ArcaidiaDeployer.deploy`'s own doc warns
    ///      about. It is safe here specifically because `deployment.settlementReceiver` above is
    ///      itself CREATE2'd from this same deployer with the same salt and no constructor
    ///      arguments of its own — identical on every chain by construction — so the value being
    ///      baked into the market's init code is identical everywhere too.
    bytes32 internal constant MARKET_V2_SALT = keccak256("arcaidia.v1.intent-market.v2");

    struct VaultV2Deployment {
        address vault;
        address settlementReceiver;
        address market;
    }

    /// @dev Same stack-depth reasoning as `RouterConfig`.
    struct VaultV2Config {
        address settlementAsset;
        uint16 reserveFloorBps;
        address treasury;
        uint16 protocolFeeShareBps;
        /// Granted `setAuthorisedSigner(..., true)` on the new vault if not
        /// address(0) — optional so a chain with no live signer yet (or one
        /// granted separately) doesn't need a placeholder.
        address solverSigner;
        /// Granted `setReporter(..., true)` on the new receiver, same rule.
        address settlementReporter;
        address owner;
        address deployingAs;
    }

    /// @notice Where the replacement vault and receiver will land, before
    ///         deploying either.
    function predictReplacementVaultAndReceiver(ArcaidiaDeployer deployer)
        internal
        view
        returns (VaultV2Deployment memory)
    {
        address predictedReceiver =
            deployer.predictAddress(RECEIVER_V2_SALT, keccak256(type(SettlementReceiver).creationCode));

        return VaultV2Deployment({
            vault: deployer.predictAddress(
                VAULT_V2_SALT, keccak256(type(ArcaidiaLiquidityVault).creationCode)
            ),
            settlementReceiver: predictedReceiver,
            market: deployer.predictAddress(
                MARKET_V2_SALT,
                keccak256(
                    abi.encodePacked(
                        type(ArcaidiaIntentMarket).creationCode,
                        abi.encode(ISettlementCheck(predictedReceiver))
                    )
                )
            )
        });
    }

    /// @notice Deploy a replacement vault and its receiver (WP-12, live
    ///         percentage-based fill limits), reusing the existing router —
    ///         neither the vault nor the receiver was ever router-aware, so
    ///         only the router's own `setDestination` needs repointing at the
    ///         new receiver, which the caller does separately with the
    ///         router's existing owner key (this function never touches the
    ///         router, since it isn't itself being redeployed).
    /// @dev The new vault's `maxFillBps`/`maxExposureBps`/`maxFeeBps` come from
    ///      `initialize()`'s own baked-in defaults (50%/80%/1.5%), not this
    ///      config — that default existing unconditionally, for every vault
    ///      this deploys from here on, is the actual fix; nothing here
    ///      overrides it, though the owner still can via `setFillLimits` later.
    function deployReplacementVaultAndReceiver(ArcaidiaDeployer deployer, VaultV2Config memory config)
        internal
        returns (VaultV2Deployment memory deployment)
    {
        address self = config.deployingAs;

        deployment.vault = deployer.deploy(
            VAULT_V2_SALT,
            type(ArcaidiaLiquidityVault).creationCode,
            abi.encodeCall(
                ArcaidiaLiquidityVault.initialize, (self, config.settlementAsset, config.reserveFloorBps)
            )
        );

        // Deployed without initializing yet — `initialize` now needs the market's address, and
        // the market needs the receiver's; same ordering as `deployAll` above.
        deployment.settlementReceiver =
            deployer.deploy(RECEIVER_V2_SALT, type(SettlementReceiver).creationCode, "");

        deployment.market = deployer.deploy(
            MARKET_V2_SALT,
            abi.encodePacked(
                type(ArcaidiaIntentMarket).creationCode,
                abi.encode(ISettlementCheck(deployment.settlementReceiver))
            ),
            ""
        );

        SettlementReceiver(deployment.settlementReceiver).initialize(
            self, config.settlementAsset, deployment.market
        );

        ArcaidiaLiquidityVault(deployment.vault).setSettlementReceiver(deployment.settlementReceiver);
        ArcaidiaLiquidityVault(deployment.vault).setMarket(deployment.market);

        if (config.treasury != address(0)) {
            ArcaidiaLiquidityVault(deployment.vault).setTreasury(config.treasury);
            ArcaidiaLiquidityVault(deployment.vault).setProtocolFeeShareBps(config.protocolFeeShareBps);
        }
        if (config.solverSigner != address(0)) {
            ArcaidiaLiquidityVault(deployment.vault).setAuthorisedSigner(config.solverSigner, true);
        }
        if (config.settlementReporter != address(0)) {
            SettlementReceiver(deployment.settlementReceiver).setReporter(config.settlementReporter, true);
        }

        ArcaidiaLiquidityVault(deployment.vault).transferOwnership(config.owner);
        SettlementReceiver(deployment.settlementReceiver).transferOwnership(config.owner);
    }
}
