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
import {MockTokenMessengerV2} from "../src/mocks/MockTokenMessengerV2.sol";
import {CircleCCTPInitiator} from "../src/CircleCCTPInitiator.sol";
import {FillAuthorization} from "../src/libraries/ArcaidiaTypes.sol";

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
    address internal protocolTreasury = makeAddr("protocolTreasury");

    uint16 internal constant RESERVE_FLOOR_BPS = 1_000;
    uint16 internal constant PROTOCOL_SHARE_BPS = 5_000;
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
            treasury: protocolTreasury,
            protocolFeeShareBps: PROTOCOL_SHARE_BPS,
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
        ArcaidiaDeployment.Deployment memory actual =
            ArcaidiaDeployment.deployAll(deployer, _config(), address(this));

        assertEq(actual.router, predicted.router, "router");
        assertEq(actual.vault, predicted.vault, "vault");
        assertEq(actual.settlementReceiver, predicted.settlementReceiver, "settlement receiver");
    }

    function test_theThreeContractsOccupyDistinctAddresses() public {
        ArcaidiaDeployment.Deployment memory d =
            ArcaidiaDeployment.deployAll(deployer, _config(), address(this));
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
        ArcaidiaDeployment.Deployment memory d =
            ArcaidiaDeployment.deployAll(deployer, _config(), address(this));

        assertTrue(ArcaidiaIntentRouter(d.router).initialized());
        assertTrue(ArcaidiaLiquidityVault(d.vault).initialized());
        assertTrue(SettlementReceiver(d.settlementReceiver).initialized());
    }

    function test_everyContractPointsAtTheConfiguredAsset() public {
        ArcaidiaDeployment.Deployment memory d =
            ArcaidiaDeployment.deployAll(deployer, _config(), address(this));

        assertEq(address(ArcaidiaIntentRouter(d.router).settlementAsset()), address(asset));
        assertEq(address(ArcaidiaLiquidityVault(d.vault).asset()), address(asset));
        assertEq(address(SettlementReceiver(d.settlementReceiver).asset()), address(asset));
    }

    function test_limitsAndFloorAreApplied() public {
        ArcaidiaDeployment.Deployment memory d =
            ArcaidiaDeployment.deployAll(deployer, _config(), address(this));

        assertEq(ArcaidiaIntentRouter(d.router).maxIntentAmount(), MAX_INTENT);
        assertEq(ArcaidiaIntentRouter(d.router).maxInFlightValue(), MAX_IN_FLIGHT);
        assertEq(ArcaidiaLiquidityVault(d.vault).reserveFloorBps(), RESERVE_FLOOR_BPS);
    }

    // -----------------------------------------------------------------------
    // Wiring
    // -----------------------------------------------------------------------

    /// Only the local receiver may reimburse the local vault.
    function test_vaultAcceptsOnlyItsOwnSettlementReceiver() public {
        ArcaidiaDeployment.Deployment memory d =
            ArcaidiaDeployment.deployAll(deployer, _config(), address(this));
        assertEq(ArcaidiaLiquidityVault(d.vault).settlementReceiver(), d.settlementReceiver);
    }

    function test_receiverKnowsItsMarket() public {
        ArcaidiaDeployment.Deployment memory d =
            ArcaidiaDeployment.deployAll(deployer, _config(), address(this));
        assertEq(address(SettlementReceiver(d.settlementReceiver).market()), d.market);
    }

    function test_treasuryAndFeeSplitAreConfigured() public {
        ArcaidiaDeployment.Deployment memory d =
            ArcaidiaDeployment.deployAll(deployer, _config(), address(this));
        assertEq(ArcaidiaLiquidityVault(d.vault).treasury(), protocolTreasury);
        assertEq(ArcaidiaLiquidityVault(d.vault).protocolFeeShareBps(), PROTOCOL_SHARE_BPS);
    }

    /// A deployment omitting the treasury leaves the whole fee with LPs rather
    /// than accruing to an address nobody set.
    function test_omittingTheTreasuryLeavesTheSplitAtZero() public {
        ArcaidiaDeployment.Config memory config = _config();
        config.treasury = address(0);

        ArcaidiaDeployment.Deployment memory d = ArcaidiaDeployment.deployAll(deployer, config, address(this));
        assertEq(ArcaidiaLiquidityVault(d.vault).treasury(), address(0));
        assertEq(ArcaidiaLiquidityVault(d.vault).protocolFeeShareBps(), 0);
    }

    function test_settlementReporterIsAuthorised() public {
        ArcaidiaDeployment.Deployment memory d =
            ArcaidiaDeployment.deployAll(deployer, _config(), address(this));
        assertTrue(SettlementReceiver(d.settlementReceiver).isReporter(settlementReporter));
        assertFalse(SettlementReceiver(d.settlementReceiver).isReporter(makeAddr("stranger")));
    }

    /// The router points at the destination chain's receiver, and only that one.
    function test_routerRoutesOnlyToTheConfiguredDestination() public {
        ArcaidiaDeployment.Config memory config = _config();
        ArcaidiaDeployment.Deployment memory d = ArcaidiaDeployment.deployAll(deployer, config, address(this));

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

        ArcaidiaDeployment.Deployment memory d = ArcaidiaDeployment.deployAll(deployer, config, address(this));
        assertFalse(SettlementReceiver(d.settlementReceiver).isReporter(address(this)));
    }

    // -----------------------------------------------------------------------
    // Ownership hand-over
    // -----------------------------------------------------------------------

    /// The deployer takes ownership only to wire, then hands it over. Leaving
    /// the deploying key as owner would put the protocol behind a hot key used
    /// once and then forgotten.
    function test_ownershipEndsWithTheIntendedOwner() public {
        ArcaidiaDeployment.Deployment memory d =
            ArcaidiaDeployment.deployAll(deployer, _config(), address(this));

        assertEq(ArcaidiaIntentRouter(d.router).owner(), protocolOwner);
        assertEq(ArcaidiaLiquidityVault(d.vault).owner(), protocolOwner);
        assertEq(SettlementReceiver(d.settlementReceiver).owner(), protocolOwner);
    }

    function test_deployingAddressRetainsNoAuthority() public {
        ArcaidiaDeployment.Deployment memory d =
            ArcaidiaDeployment.deployAll(deployer, _config(), address(this));

        vm.expectRevert(ArcaidiaLiquidityVault.NotOwner.selector);
        ArcaidiaLiquidityVault(d.vault).setPaused(true);

        vm.expectRevert(ArcaidiaIntentRouter.NotOwner.selector);
        ArcaidiaIntentRouter(d.router).setPaused(true);

        vm.expectRevert(SettlementReceiver.NotOwner.selector);
        SettlementReceiver(d.settlementReceiver).setReporter(address(this), true);
    }

    function test_intendedOwnerCanOperateImmediately() public {
        ArcaidiaDeployment.Deployment memory d =
            ArcaidiaDeployment.deployAll(deployer, _config(), address(this));

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
        ArcaidiaDeployment.Deployment memory d =
            ArcaidiaDeployment.deployAll(deployer, _config(), address(this));

        address user = makeAddr("user");
        asset.mint(user, 10_000e6);

        vm.startPrank(user);
        asset.approve(d.router, type(uint256).max);
        bytes32 intentId = ArcaidiaIntentRouter(d.router)
            .createIntent(
                makeAddr("recipient"), 1_000e6, destinationChainId, 30, uint64(block.timestamp + 1 hours), 1
            , address(0), 0);
        vm.stopPrank();

        assertTrue(ArcaidiaIntentRouter(d.router).intentExists(intentId));
        assertEq(initiator.totalCommitted(), 1_000e6);
    }

    /// And must accept LP capital without further setup.
    function test_freshDeploymentAcceptsLiquidity() public {
        ArcaidiaDeployment.Deployment memory d =
            ArcaidiaDeployment.deployAll(deployer, _config(), address(this));

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

    // -----------------------------------------------------------------------
    // Replacement router (WP-10)
    // -----------------------------------------------------------------------
    //
    // `settlementInitiator` is fixed at the router's `initialize()` with no
    // setter, so wiring in the real CCTP transport means deploying a *new*
    // router rather than upgrading the existing one. These tests exercise that
    // path: a fresh router at `ROUTER_CCTP_SALT`, reusing the vault and
    // receiver an ordinary `deployAll` already produced.

    function _deployBase() internal returns (ArcaidiaDeployment.Deployment memory) {
        return ArcaidiaDeployment.deployAll(deployer, _config(), address(this));
    }

    function test_replacementRouterLandsWherePredicted() public {
        _deployBase();
        address predicted = ArcaidiaDeployment.predictReplacementRouter(deployer);

        address router = ArcaidiaDeployment.deployReplacementRouter(
            deployer,
            ArcaidiaDeployment.RouterConfig({
                settlementInitiator: address(initiator),
                settlementAsset: address(asset),
                destinationChainId: destinationChainId,
                destinationSettlementReceiver: makeAddr("destinationReceiver"),
                maxIntentAmount: MAX_INTENT,
                maxInFlightValue: MAX_IN_FLIGHT,
                owner: protocolOwner,
                deployingAs: address(this)
            })
        );

        assertEq(router, predicted);
    }

    function test_replacementRouterDiffersFromTheOriginal() public {
        ArcaidiaDeployment.Deployment memory original = _deployBase();

        address router = ArcaidiaDeployment.deployReplacementRouter(
            deployer,
            ArcaidiaDeployment.RouterConfig({
                settlementInitiator: address(initiator),
                settlementAsset: address(asset),
                destinationChainId: destinationChainId,
                destinationSettlementReceiver: makeAddr("destinationReceiver"),
                maxIntentAmount: MAX_INTENT,
                maxInFlightValue: MAX_IN_FLIGHT,
                owner: protocolOwner,
                deployingAs: address(this)
            })
        );

        assertTrue(router != original.router, "replacement must not collide with the original router");
    }

    function test_replacementRouterIsOwnedByTheConfiguredOwner() public {
        _deployBase();

        address router = ArcaidiaDeployment.deployReplacementRouter(
            deployer,
            ArcaidiaDeployment.RouterConfig({
                settlementInitiator: address(initiator),
                settlementAsset: address(asset),
                destinationChainId: destinationChainId,
                destinationSettlementReceiver: makeAddr("destinationReceiver"),
                maxIntentAmount: MAX_INTENT,
                maxInFlightValue: MAX_IN_FLIGHT,
                owner: protocolOwner,
                deployingAs: address(this)
            })
        );

        assertEq(ArcaidiaIntentRouter(router).owner(), protocolOwner);
    }

    /// The reused vault must accept a fill routed through the *replacement*
    /// router's intent exactly as it would through the original — proof that
    /// neither contract stores or checks a router address.
    function test_replacementRouterInteroperatesWithTheReusedVaultAndReceiver() public {
        ArcaidiaDeployment.Deployment memory base = _deployBase();

        MockTokenMessengerV2 tokenMessenger = new MockTokenMessengerV2();
        CircleCCTPInitiator cctp =
            new CircleCCTPInitiator(address(this), address(tokenMessenger), address(asset));
        cctp.setDomain(destinationChainId, 26);

        address router = ArcaidiaDeployment.deployReplacementRouter(
            deployer,
            ArcaidiaDeployment.RouterConfig({
                settlementInitiator: address(cctp),
                settlementAsset: address(asset),
                destinationChainId: destinationChainId,
                // CREATE2 parity: the receiver `deployAll` produced is what a
                // real redeploy would also pass here.
                destinationSettlementReceiver: base.settlementReceiver,
                maxIntentAmount: MAX_INTENT,
                maxInFlightValue: MAX_IN_FLIGHT,
                owner: protocolOwner,
                deployingAs: address(this)
            })
        );

        address user = makeAddr("cctpUser");
        asset.mint(user, 10_000e6);

        vm.startPrank(user);
        asset.approve(router, type(uint256).max);
        bytes32 intentId = ArcaidiaIntentRouter(router)
            .createIntent(
                makeAddr("recipient"), 1_000e6, destinationChainId, 30, uint64(block.timestamp + 1 hours), 1
            , address(0), 0);
        vm.stopPrank();

        assertTrue(ArcaidiaIntentRouter(router).intentExists(intentId));
        assertEq(tokenMessenger.callCount(), 1, "the replacement router's intent must burn through real CCTP");

        // The pre-existing vault, from the base deployment, is unaffected and
        // still independently usable — nothing about it was touched.
        address lp = makeAddr("cctpLp");
        asset.mint(lp, 50_000e6);
        vm.startPrank(lp);
        asset.approve(base.vault, type(uint256).max);
        uint256 shares = ArcaidiaLiquidityVault(base.vault).deposit(50_000e6, lp);
        vm.stopPrank();
        assertGt(shares, 0);
    }

    // -----------------------------------------------------------------------
    // Replacement vault + receiver (WP-12)
    // -----------------------------------------------------------------------
    //
    // `maxFillBps`/`maxExposureBps` replaced flat absolutes on the vault, and
    // `SettlementReceiver.vault` is fixed at `initialize()` with no setter, so
    // this is a new vault AND a new receiver, reusing the existing router (it
    // never stored a vault or receiver address either).

    function _v2Config(address solverSigner, address reporter)
        internal
        view
        returns (ArcaidiaDeployment.VaultV2Config memory)
    {
        return ArcaidiaDeployment.VaultV2Config({
            settlementAsset: address(asset),
            reserveFloorBps: RESERVE_FLOOR_BPS,
            treasury: protocolTreasury,
            protocolFeeShareBps: PROTOCOL_SHARE_BPS,
            solverSigner: solverSigner,
            settlementReporter: reporter,
            owner: protocolOwner,
            deployingAs: address(this)
        });
    }

    function test_replacementVaultAndReceiverLandWherePredicted() public {
        ArcaidiaDeployment.VaultV2Deployment memory predicted =
            ArcaidiaDeployment.predictReplacementVaultAndReceiver(deployer);

        ArcaidiaDeployment.VaultV2Deployment memory d =
            ArcaidiaDeployment.deployReplacementVaultAndReceiver(deployer, _v2Config(address(0), address(0)));

        assertEq(d.vault, predicted.vault, "vault");
        assertEq(d.settlementReceiver, predicted.settlementReceiver, "settlement receiver");
    }

    function test_replacementVaultDiffersFromTheOriginal() public {
        ArcaidiaDeployment.Deployment memory original = _deployBase();

        ArcaidiaDeployment.VaultV2Deployment memory d =
            ArcaidiaDeployment.deployReplacementVaultAndReceiver(deployer, _v2Config(address(0), address(0)));

        assertTrue(d.vault != original.vault, "replacement must not collide with the original vault");
        assertTrue(
            d.settlementReceiver != original.settlementReceiver,
            "replacement must not collide with the original receiver"
        );
    }

    /// The whole point: a fresh vault fills immediately, no `setFillLimits`
    /// call required — this is what shipping without one, on the original
    /// vault, actually cost (see ArcaidiaLiquidityVault's DEFAULT_MAX_*_BPS).
    function test_replacementVaultAcceptsAFillWithNoFurtherOwnerAction() public {
        (address agent, uint256 agentKey) = makeAddrAndKey("v2Agent");

        ArcaidiaDeployment.VaultV2Deployment memory d =
            ArcaidiaDeployment.deployReplacementVaultAndReceiver(deployer, _v2Config(agent, address(0)));

        address lp = makeAddr("v2Lp");
        asset.mint(lp, 100_000e6);
        vm.startPrank(lp);
        asset.approve(d.vault, type(uint256).max);
        ArcaidiaLiquidityVault(d.vault).deposit(100_000e6, lp);
        vm.stopPrank();

        FillAuthorization memory auth = FillAuthorization({
            intentId: keccak256("v2-intent"),
            sourceChainId: sourceChainId,
            sourceTxHash: keccak256("v2-tx"),
            recipient: makeAddr("v2Recipient"),
            inputAmount: 10_000e6,
            outputAmount: 9_950e6,
            feeAmount: 50e6,
            expiry: uint64(block.timestamp + 1 hours),
            nonce: 1
        });
        // The domain separator binds to block.chainid, so signing must happen
        // on the destination chain — the same chain fastFill will verify on.
        vm.chainId(destinationChainId);
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(agentKey, ArcaidiaLiquidityVault(d.vault).hashFillAuthorization(auth));

        address signer = ArcaidiaLiquidityVault(d.vault).fastFill(auth, abi.encodePacked(r, s, v));

        assertEq(signer, agent);
        assertEq(asset.balanceOf(auth.recipient), 9_950e6);
    }

    function test_replacementVaultPointsAtItsOwnNewReceiver() public {
        ArcaidiaDeployment.VaultV2Deployment memory d =
            ArcaidiaDeployment.deployReplacementVaultAndReceiver(deployer, _v2Config(address(0), address(0)));

        assertEq(ArcaidiaLiquidityVault(d.vault).settlementReceiver(), d.settlementReceiver);
        assertEq(address(SettlementReceiver(d.settlementReceiver).market()), d.market);
    }

    function test_replacementSolverSignerIsAuthorisedWhenProvided() public {
        address signer = makeAddr("v2Signer");
        ArcaidiaDeployment.VaultV2Deployment memory d =
            ArcaidiaDeployment.deployReplacementVaultAndReceiver(deployer, _v2Config(signer, address(0)));

        assertTrue(ArcaidiaLiquidityVault(d.vault).isAuthorisedSigner(signer));
    }

    function test_omittingTheReplacementSolverSignerAuthorisesNobody() public {
        ArcaidiaDeployment.VaultV2Deployment memory d =
            ArcaidiaDeployment.deployReplacementVaultAndReceiver(deployer, _v2Config(address(0), address(0)));

        assertFalse(ArcaidiaLiquidityVault(d.vault).isAuthorisedSigner(address(this)));
    }

    function test_replacementReporterIsGrantedWhenProvided() public {
        address reporter = makeAddr("v2Reporter");
        ArcaidiaDeployment.VaultV2Deployment memory d =
            ArcaidiaDeployment.deployReplacementVaultAndReceiver(deployer, _v2Config(address(0), reporter));

        assertTrue(SettlementReceiver(d.settlementReceiver).isReporter(reporter));
    }

    function test_replacementVaultAndReceiverAreOwnedByTheConfiguredOwner() public {
        ArcaidiaDeployment.VaultV2Deployment memory d =
            ArcaidiaDeployment.deployReplacementVaultAndReceiver(deployer, _v2Config(address(0), address(0)));

        assertEq(ArcaidiaLiquidityVault(d.vault).owner(), protocolOwner);
        assertEq(SettlementReceiver(d.settlementReceiver).owner(), protocolOwner);
    }

    function test_deployingAddressRetainsNoAuthorityOverTheReplacementVault() public {
        ArcaidiaDeployment.VaultV2Deployment memory d =
            ArcaidiaDeployment.deployReplacementVaultAndReceiver(deployer, _v2Config(address(0), address(0)));

        vm.expectRevert(ArcaidiaLiquidityVault.NotOwner.selector);
        ArcaidiaLiquidityVault(d.vault).setPaused(true);
    }

    /// The original vault is untouched by a WP-12 redeploy — no pause, no
    /// forced withdrawal, nothing. Existing LPs migrate by their own choice,
    /// on their own timeline, with two ordinary calls (redeem, then deposit).
    function test_theOriginalVaultIsUntouchedByTheReplacement() public {
        ArcaidiaDeployment.Deployment memory original = _deployBase();

        address lp = makeAddr("originalLp");
        asset.mint(lp, 20_000e6);
        vm.startPrank(lp);
        asset.approve(original.vault, type(uint256).max);
        ArcaidiaLiquidityVault(original.vault).deposit(20_000e6, lp);
        vm.stopPrank();

        ArcaidiaDeployment.deployReplacementVaultAndReceiver(deployer, _v2Config(address(0), address(0)));

        assertFalse(ArcaidiaLiquidityVault(original.vault).paused());
        assertEq(ArcaidiaLiquidityVault(original.vault).totalAssets(), 20_000e6);
    }
}
