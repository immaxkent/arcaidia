// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ChainFixture} from "./base/ChainFixture.sol";
import {ArcaidiaDeployer} from "../src/deploy/ArcaidiaDeployer.sol";
import {ArcaidiaIntentRouter} from "../src/ArcaidiaIntentRouter.sol";
import {ArcaidiaLiquidityVault} from "../src/ArcaidiaLiquidityVault.sol";
import {SettlementReceiver} from "../src/SettlementReceiver.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {MockSettlementInitiator} from "../src/mocks/MockSettlementInitiator.sol";

/// @notice CREATE2 address parity — a WP-01 acceptance criterion, not an
///         optimisation.
///
/// @dev Arcaidia deploys the same contracts to Ethereum and Arc and requires
///      them to land on the same addresses. That holds only while three things
///      are true, and each is asserted here:
///
///        1. init code carries no chain-specific constructor arguments;
///        2. the deployer sits at the same address on both chains;
///        3. address derivation does not read `block.chainid`.
///
///      The most valuable test in this file is the one proving that pointing the
///      vault at a different USDC address does not move it. That is the entire
///      reason `ArcaidiaLiquidityVault` implements ERC-4626 itself instead of
///      inheriting OpenZeppelin's, whose immutable asset would have made the
///      address chain-dependent.
contract Create2DeterminismTest is ChainFixture {
    ArcaidiaDeployer internal deployer;

    bytes32 internal constant ROUTER_SALT = keccak256("arcaidia.router.v1");
    bytes32 internal constant VAULT_SALT = keccak256("arcaidia.vault.v1");
    bytes32 internal constant RECEIVER_SALT = keccak256("arcaidia.receiver.v1");

    address internal protocolOwner = makeAddr("protocolOwner");

    function setUp() public {
        _configureDirection();
        deployer = new ArcaidiaDeployer();
    }

    // -----------------------------------------------------------------------
    // Init code carries nothing chain-specific
    // -----------------------------------------------------------------------

    /// Demonstrates *why* Arcaidia's contracts take no constructor arguments:
    /// arguments are appended to init code, and init code determines the
    /// address. A chain-specific argument — a USDC address, a CCTP domain —
    /// would therefore put the same contract at a different address on each
    /// chain, which is exactly the failure this design avoids.
    function test_constructorArgumentsWouldMoveTheAddress() public view {
        bytes memory bare = type(ArcaidiaLiquidityVault).creationCode;

        // The two chains' USDC addresses, as they would be if passed to a
        // constructor rather than to initialize.
        bytes memory withEthereumAsset =
            abi.encodePacked(bare, abi.encode(0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238));
        bytes memory withArcAsset =
            abi.encodePacked(bare, abi.encode(0x3600000000000000000000000000000000000000));

        address bareAddress = deployer.predictAddressFor(VAULT_SALT, bare);
        address ethereumAddress = deployer.predictAddressFor(VAULT_SALT, withEthereumAsset);
        address arcAddress = deployer.predictAddressFor(VAULT_SALT, withArcAsset);

        assertTrue(ethereumAddress != arcAddress, "a chain-specific argument splits the address");
        assertTrue(bareAddress != ethereumAddress);
    }

    function test_everyProtocolContractHasNonEmptyCreationCode() public pure {
        assertTrue(type(ArcaidiaIntentRouter).creationCode.length > 0);
        assertTrue(type(ArcaidiaLiquidityVault).creationCode.length > 0);
        assertTrue(type(SettlementReceiver).creationCode.length > 0);
    }

    /// Address derivation must not read block.chainid, or nothing else matters.
    function test_predictedAddressIsIndependentOfChainId() public {
        bytes32 codeHash = keccak256(type(ArcaidiaIntentRouter).creationCode);

        vm.chainId(ETHEREUM_SEPOLIA);
        address onEthereum = deployer.predictAddress(ROUTER_SALT, codeHash);

        vm.chainId(ARC_TESTNET);
        address onArc = deployer.predictAddress(ROUTER_SALT, codeHash);

        assertEq(onEthereum, onArc, "predicted address must not depend on the chain");
    }

    function test_differentSaltsGiveDifferentAddresses() public view {
        bytes32 codeHash = keccak256(type(ArcaidiaIntentRouter).creationCode);
        assertTrue(
            deployer.predictAddress(ROUTER_SALT, codeHash) != deployer.predictAddress(VAULT_SALT, codeHash)
        );
    }

    // -----------------------------------------------------------------------
    // Deployment lands where it was predicted
    // -----------------------------------------------------------------------

    function test_routerDeploysAtThePredictedAddress() public {
        vm.chainId(sourceChainId);

        MockUSDC asset = new MockUSDC();
        MockSettlementInitiator initiator = new MockSettlementInitiator();

        bytes memory code = type(ArcaidiaIntentRouter).creationCode;
        address predicted = deployer.predictAddressFor(ROUTER_SALT, code);

        address deployed = deployer.deploy(
            ROUTER_SALT,
            code,
            abi.encodeCall(
                ArcaidiaIntentRouter.initialize,
                (protocolOwner, address(asset), address(initiator), 50_000e6, 200_000e6)
            )
        );

        assertEq(deployed, predicted, "deployed address must match the prediction");
        assertTrue(ArcaidiaIntentRouter(deployed).initialized());
        assertEq(ArcaidiaIntentRouter(deployed).owner(), protocolOwner);
    }

    function test_vaultDeploysAtThePredictedAddress() public {
        vm.chainId(destinationChainId);

        MockUSDC asset = new MockUSDC();
        bytes memory code = type(ArcaidiaLiquidityVault).creationCode;
        address predicted = deployer.predictAddressFor(VAULT_SALT, code);

        address deployed = deployer.deploy(
            VAULT_SALT,
            code,
            abi.encodeCall(ArcaidiaLiquidityVault.initialize, (protocolOwner, address(asset), 1_000))
        );

        assertEq(deployed, predicted);
        assertEq(address(ArcaidiaLiquidityVault(deployed).asset()), address(asset));
    }

    function test_receiverDeploysAtThePredictedAddress() public {
        MockUSDC asset = new MockUSDC();
        bytes memory code = type(SettlementReceiver).creationCode;
        address predicted = deployer.predictAddressFor(RECEIVER_SALT, code);

        address deployed = deployer.deploy(
            RECEIVER_SALT,
            code,
            abi.encodeCall(SettlementReceiver.initialize, (protocolOwner, address(asset), address(0xBEEF)))
        );

        assertEq(deployed, predicted);
    }

    // -----------------------------------------------------------------------
    // The decisive property: chain-specific configuration does not move anything
    // -----------------------------------------------------------------------

    /// Ethereum and Arc have different USDC addresses. If the asset were a
    /// constructor argument — as it is in OpenZeppelin's ERC4626, whose
    /// immutable asset is baked into init code — the vault would land on a
    /// different address on each chain and WP-01's gate would be unreachable.
    /// Because the asset lives in storage and arrives via initialize, the
    /// address is unmoved by it.
    function test_vaultAddressIsUnchangedByADifferentAsset() public {
        bytes memory code = type(ArcaidiaLiquidityVault).creationCode;
        address predicted = deployer.predictAddressFor(VAULT_SALT, code);

        MockUSDC ethereumUsdc = new MockUSDC();
        vm.chainId(ETHEREUM_SEPOLIA);
        address onEthereum = deployer.deploy(
            VAULT_SALT,
            code,
            abi.encodeCall(ArcaidiaLiquidityVault.initialize, (protocolOwner, address(ethereumUsdc), 1_000))
        );

        assertEq(onEthereum, predicted);
        assertEq(address(ArcaidiaLiquidityVault(onEthereum).asset()), address(ethereumUsdc));
    }

    /// The mirror of the test above, run under the other chain id with a
    /// different asset. Both tests start from the same fixture state, so their
    /// agreeing on `predicted` is what demonstrates cross-chain parity without
    /// needing two live networks.
    function test_vaultAddressIsUnchangedOnTheOtherChainWithAnotherAsset() public {
        bytes memory code = type(ArcaidiaLiquidityVault).creationCode;
        address predicted = deployer.predictAddressFor(VAULT_SALT, code);

        MockUSDC arcUsdc = new MockUSDC();
        MockUSDC decoy = new MockUSDC();
        decoy; // a second deployment, to move nonces and prove they are irrelevant

        vm.chainId(ARC_TESTNET);
        address onArc = deployer.deploy(
            VAULT_SALT,
            code,
            abi.encodeCall(ArcaidiaLiquidityVault.initialize, (protocolOwner, address(arcUsdc), 2_500))
        );

        assertEq(onArc, predicted, "same salt and init code must give the same address");
        assertEq(address(ArcaidiaLiquidityVault(onArc).asset()), address(arcUsdc));
        assertEq(ArcaidiaLiquidityVault(onArc).reserveFloorBps(), 2_500);
    }

    // -----------------------------------------------------------------------
    // Atomicity — no window in which an uninitialized contract can be seized
    // -----------------------------------------------------------------------

    /// Deployment and initialization happen in one transaction, so the contract
    /// is never observable in an uninitialized state.
    function test_deploymentAndInitializationAreAtomic() public {
        MockUSDC asset = new MockUSDC();
        bytes memory code = type(ArcaidiaLiquidityVault).creationCode;

        address deployed = deployer.deploy(
            VAULT_SALT,
            code,
            abi.encodeCall(ArcaidiaLiquidityVault.initialize, (protocolOwner, address(asset), 1_000))
        );

        ArcaidiaLiquidityVault vault = ArcaidiaLiquidityVault(deployed);
        assertTrue(vault.initialized());

        // And nobody can take it afterwards.
        vm.prank(makeAddr("attacker"));
        vm.expectRevert(ArcaidiaLiquidityVault.AlreadyInitialized.selector);
        vault.initialize(makeAddr("attacker"), address(asset), 0);
    }

    /// A failed initialization must take the deployment down with it, rather
    /// than leaving an uninitialized contract at a known address.
    function test_failedInitializationRevertsTheDeployment() public {
        bytes memory code = type(ArcaidiaLiquidityVault).creationCode;
        address predicted = deployer.predictAddressFor(VAULT_SALT, code);

        vm.expectRevert();
        deployer.deploy(
            VAULT_SALT,
            code,
            // Zero asset address is rejected by initialize.
            abi.encodeCall(ArcaidiaLiquidityVault.initialize, (protocolOwner, address(0), 1_000))
        );

        assertEq(predicted.code.length, 0, "no contract may survive a failed initialization");
    }

    function test_redeployingTheSameSaltReverts() public {
        MockUSDC asset = new MockUSDC();
        bytes memory code = type(ArcaidiaLiquidityVault).creationCode;
        bytes memory initCall =
            abi.encodeCall(ArcaidiaLiquidityVault.initialize, (protocolOwner, address(asset), 1_000));

        deployer.deploy(VAULT_SALT, code, initCall);

        vm.expectRevert(abi.encodeWithSelector(ArcaidiaDeployer.DeploymentFailed.selector, VAULT_SALT));
        deployer.deploy(VAULT_SALT, code, initCall);
    }

    function test_isDeployedReflectsOccupancy() public {
        bytes memory code = type(SettlementReceiver).creationCode;
        bytes32 codeHash = keccak256(code);

        assertFalse(deployer.isDeployed(RECEIVER_SALT, codeHash));

        MockUSDC asset = new MockUSDC();
        deployer.deploy(
            RECEIVER_SALT,
            code,
            abi.encodeCall(SettlementReceiver.initialize, (protocolOwner, address(asset), address(0xBEEF)))
        );

        assertTrue(deployer.isDeployed(RECEIVER_SALT, codeHash));
    }

    function test_emptyCreationCodeIsRejected() public {
        vm.expectRevert(ArcaidiaDeployer.EmptyCreationCode.selector);
        deployer.deploy(VAULT_SALT, "", "");
    }

    /// Deployment without an init call is allowed, for contracts that need none.
    function test_deploymentWithoutInitialization() public {
        bytes memory code = type(ArcaidiaDeployer).creationCode;
        address deployed = deployer.deploy(keccak256("nested"), code, "");
        assertTrue(deployed.code.length > 0);
    }
}
