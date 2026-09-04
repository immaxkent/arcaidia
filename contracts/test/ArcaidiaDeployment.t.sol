// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ChainFixture} from "./base/ChainFixture.sol";
import {ArcaidiaDeployer} from "../src/deploy/ArcaidiaDeployer.sol";
import {ArcaidiaDeployment} from "../src/deploy/ArcaidiaDeployment.sol";
import {ArcaidiaIntentRouter} from "../src/ArcaidiaIntentRouter.sol";
import {ArcaidiaLiquidityVault} from "../src/ArcaidiaLiquidityVault.sol";
import {SettlementReceiver} from "../src/SettlementReceiver.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {MockSettlementInitiator} from "../src/mocks/MockSettlementInitiator.sol";

/// @notice The deployment as it will actually run, exercised in both directions.
/// @dev Wiring is where deployments fail, and a wiring mistake is only visible
///      once real funds move through the wrong contract. Every link is asserted
///      here instead.
contract ArcaidiaDeploymentTest is ChainFixture {
    using ArcaidiaDeployment for ArcaidiaDeployer;

    ArcaidiaDeployer internal deployer;
    MockUSDC internal asset;
    MockSettlementInitiator internal initiator;

    address internal protocolOwner = makeAddr("protocolOwner");
    address internal settlementReporter = makeAddr("settlementReporter");

    uint16 internal constant RESERVE_FLOOR_BPS = 1_000;
    uint256 internal constant MAX_INTENT = 50_000e6;
    uint256 internal constant MAX_IN_FLIGHT = 200_000e6;

    function setUp() public {
        _configureDirection();
        vm.chainId(sourceChainId);
        deployer = new ArcaidiaDeployer();
        asset = new MockUSDC();
        initiator = new MockSettlementInitiator();
    }

    function _config() internal view returns (ArcaidiaDeployment.Config memory) {
        ArcaidiaDeployment.Deployment memory predicted = ArcaidiaDeployment.predict(deployer);
        return ArcaidiaDeployment.Config({
            owner: protocolOwner,
            settlementAsset: address(asset),
            settlementInitiator: address(initiator),
            destinationChainId: destinationChainId,
            // CREATE2 parity means the destination receiver shares this address.
            destinationSettlementReceiver: predicted.settlementReceiver,
            reserveFloorBps: RESERVE_FLOOR_BPS,
            maxIntentAmount: MAX_INTENT,
            maxInFlightValue: MAX_IN_FLIGHT,
            settlementReporter: settlementReporter
        });
    }

    // -----------------------------------------------------------------------
    // Prediction
    // -----------------------------------------------------------------------

    /// The script prints and asserts these before broadcasting, so a mismatch
    /// is caught before funds are spent rather than after.
    function test_deploymentLandsWherePredicted() public {
        ArcaidiaDeployment.Deployment memory predicted = ArcaidiaDeployment.predict(deployer);
        ArcaidiaDeployment.Deployment memory actual = ArcaidiaDeployment.deployAll(deployer, _config());

        assertEq(actual.router, predicted.router, "router");
        assertEq(actual.vault, predicted.vault, "vault");
        assertEq(actual.settlementReceiver, predicted.settlementReceiver, "settlement receiver");
    }

    function test_theThreeContractsOccupyDistinctAddresses() public {
        ArcaidiaDeployment.Deployment memory d = ArcaidiaDeployment.deployAll(deployer, _config());
        assertTrue(d.router != d.vault);
        assertTrue(d.vault != d.settlementReceiver);
        assertTrue(d.router != d.settlementReceiver);
    }

    /// Predicted addresses are the same whichever chain the deployment runs on.
    function test_predictionIsIdenticalOnBothChains() public {
        vm.chainId(ETHEREUM_SEPOLIA);
        ArcaidiaDeployment.Deployment memory onEthereum = ArcaidiaDeployment.predict(deployer);

        vm.chainId(ARC_TESTNET);
        ArcaidiaDeployment.Deployment memory onArc = ArcaidiaDeployment.predict(deployer);

        assertEq(onEthereum.router, onArc.router);
        assertEq(onEthereum.vault, onArc.vault);
        assertEq(onEthereum.settlementReceiver, onArc.settlementReceiver);
    }

    // -----------------------------------------------------------------------
    // Configuration
    // -----------------------------------------------------------------------

    function test_allThreeContractsAreInitialized() public {
        ArcaidiaDeployment.Deployment memory d = ArcaidiaDeployment.deployAll(deployer, _config());

        assertTrue(ArcaidiaIntentRouter(d.router).initialized());
        assertTrue(ArcaidiaLiquidityVault(d.vault).initialized());
        assertTrue(SettlementReceiver(d.settlementReceiver).initialized());
    }

    function test_everyContractPointsAtTheConfiguredAsset() public {
        ArcaidiaDeployment.Deployment memory d = ArcaidiaDeployment.deployAll(deployer, _config());

        assertEq(address(ArcaidiaIntentRouter(d.router).settlementAsset()), address(asset));
        assertEq(address(ArcaidiaLiquidityVault(d.vault).asset()), address(asset));
        assertEq(address(SettlementReceiver(d.settlementReceiver).asset()), address(asset));
    }

    function test_limitsAndFloorAreApplied() public {
        ArcaidiaDeployment.Deployment memory d = ArcaidiaDeployment.deployAll(deployer, _config());

        assertEq(ArcaidiaIntentRouter(d.router).maxIntentAmount(), MAX_INTENT);
        assertEq(ArcaidiaIntentRouter(d.router).maxInFlightValue(), MAX_IN_FLIGHT);
        assertEq(ArcaidiaLiquidityVault(d.vault).reserveFloorBps(), RESERVE_FLOOR_BPS);
    }

    // -----------------------------------------------------------------------
    // Wiring
    // -----------------------------------------------------------------------

    /// Only the local receiver may reimburse the local vault.
    function test_vaultAcceptsOnlyItsOwnSettlementReceiver() public {
        ArcaidiaDeployment.Deployment memory d = ArcaidiaDeployment.deployAll(deployer, _config());
        assertEq(ArcaidiaLiquidityVault(d.vault).settlementReceiver(), d.settlementReceiver);
    }

    function test_receiverKnowsItsVault() public {
        ArcaidiaDeployment.Deployment memory d = ArcaidiaDeployment.deployAll(deployer, _config());
        assertEq(address(SettlementReceiver(d.settlementReceiver).vault()), d.vault);
    }

    function test_settlementReporterIsAuthorised() public {
        ArcaidiaDeployment.Deployment memory d = ArcaidiaDeployment.deployAll(deployer, _config());
        assertTrue(SettlementReceiver(d.settlementReceiver).isReporter(settlementReporter));
        assertFalse(SettlementReceiver(d.settlementReceiver).isReporter(makeAddr("stranger")));
    }

    /// The router points at the destination chain's receiver, and only that one.
    function test_routerRoutesOnlyToTheConfiguredDestination() public {
        ArcaidiaDeployment.Config memory config = _config();
        ArcaidiaDeployment.Deployment memory d = ArcaidiaDeployment.deployAll(deployer, config);

        assertEq(
            ArcaidiaIntentRouter(d.router).destinationReceiver(destinationChainId),
            config.destinationSettlementReceiver
        );
        assertEq(ArcaidiaIntentRouter(d.router).destinationReceiver(999_999), address(0));
    }

    /// A deployment omitting the reporter leaves nobody authorised, rather than
    /// silently authorising the deployer.
    function test_omittingTheReporterAuthorisesNobody() public {
        ArcaidiaDeployment.Config memory config = _config();
        config.settlementReporter = address(0);

        ArcaidiaDeployment.Deployment memory d = ArcaidiaDeployment.deployAll(deployer, config);
        assertFalse(SettlementReceiver(d.settlementReceiver).isReporter(address(this)));
    }

    // -----------------------------------------------------------------------
    // Ownership hand-over
    // -----------------------------------------------------------------------

    /// The deployer takes ownership only to wire, then hands it over. Leaving
    /// the deploying key as owner would put the protocol behind a hot key used
    /// once and then forgotten.
    function test_ownershipEndsWithTheIntendedOwner() public {
        ArcaidiaDeployment.Deployment memory d = ArcaidiaDeployment.deployAll(deployer, _config());

        assertEq(ArcaidiaIntentRouter(d.router).owner(), protocolOwner);
        assertEq(ArcaidiaLiquidityVault(d.vault).owner(), protocolOwner);
        assertEq(SettlementReceiver(d.settlementReceiver).owner(), protocolOwner);
    }

    function test_deployingAddressRetainsNoAuthority() public {
        ArcaidiaDeployment.Deployment memory d = ArcaidiaDeployment.deployAll(deployer, _config());

        vm.expectRevert(ArcaidiaLiquidityVault.NotOwner.selector);
        ArcaidiaLiquidityVault(d.vault).setPaused(true);

        vm.expectRevert(ArcaidiaIntentRouter.NotOwner.selector);
        ArcaidiaIntentRouter(d.router).setPaused(true);

        vm.expectRevert(SettlementReceiver.NotOwner.selector);
        SettlementReceiver(d.settlementReceiver).setReporter(address(this), true);
    }

    function test_intendedOwnerCanOperateImmediately() public {
        ArcaidiaDeployment.Deployment memory d = ArcaidiaDeployment.deployAll(deployer, _config());

        vm.startPrank(protocolOwner);
        ArcaidiaLiquidityVault(d.vault).setPaused(true);
        ArcaidiaIntentRouter(d.router).setPaused(true);
        vm.stopPrank();

        assertTrue(ArcaidiaLiquidityVault(d.vault).paused());
        assertTrue(ArcaidiaIntentRouter(d.router).paused());
    }

    // -----------------------------------------------------------------------
    // The deployment is usable end to end
    // -----------------------------------------------------------------------

    /// A freshly deployed protocol must accept an intent without further setup.
    function test_freshDeploymentAcceptsAnIntent() public {
        ArcaidiaDeployment.Deployment memory d = ArcaidiaDeployment.deployAll(deployer, _config());

        address user = makeAddr("user");
        asset.mint(user, 10_000e6);

        vm.startPrank(user);
        asset.approve(d.router, type(uint256).max);
        bytes32 intentId = ArcaidiaIntentRouter(d.router)
            .createIntent(
                makeAddr("recipient"), 1_000e6, destinationChainId, 30, uint64(block.timestamp + 1 hours), 1
            );
        vm.stopPrank();

        assertTrue(ArcaidiaIntentRouter(d.router).intentExists(intentId));
        assertEq(initiator.totalCommitted(), 1_000e6);
    }

    /// And must accept LP capital without further setup.
    function test_freshDeploymentAcceptsLiquidity() public {
        ArcaidiaDeployment.Deployment memory d = ArcaidiaDeployment.deployAll(deployer, _config());

        address lp = makeAddr("lp");
        asset.mint(lp, 100_000e6);

        vm.startPrank(lp);
        asset.approve(d.vault, type(uint256).max);
        uint256 shares = ArcaidiaLiquidityVault(d.vault).deposit(100_000e6, lp);
        vm.stopPrank();

        assertGt(shares, 0);
        assertEq(ArcaidiaLiquidityVault(d.vault).totalAssets(), 100_000e6);
        assertEq(ArcaidiaLiquidityVault(d.vault).availableLiquidity(), 90_000e6);
    }
}
