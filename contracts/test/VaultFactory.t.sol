// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ChainFixture} from "./base/ChainFixture.sol";
import {Vm} from "forge-std/Vm.sol";
import {NeverSettledCheck} from "./base/VaultFixture.sol";
import {TestPolicies} from "./base/TestPolicies.sol";
import {ArcaidiaDeployer} from "../src/deploy/ArcaidiaDeployer.sol";
import {ArcaidiaIntentMarket} from "../src/ArcaidiaIntentMarket.sol";
import {ArcaidiaLiquidityVault} from "../src/ArcaidiaLiquidityVault.sol";
import {ArcaidiaVaultFactory} from "../src/ArcaidiaVaultFactory.sol";
import {ISettlementCheck} from "../src/interfaces/ISettlementCheck.sol";
import {IVaultRegistry} from "../src/interfaces/IVaultRegistry.sol";
import {FeePolicy} from "../src/libraries/ArcaidiaTypes.sol";
import {FeePolicyLib} from "../src/libraries/FeePolicyLib.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

/// @notice WP-26 / D10 / D11: permissionless standard-vault creation and the market's registry.
contract VaultFactoryTest is ChainFixture {
    ArcaidiaDeployer internal deployer;
    MockUSDC internal asset;
    ArcaidiaVaultFactory internal factory;
    ArcaidiaIntentMarket internal market;
    address internal receiver = makeAddr("receiver");
    address internal protocolOwner = makeAddr("protocolOwner");

    bytes32 internal constant FACTORY_SALT = keccak256("test.factory");

    function setUp() public {
        _configureDirection();
        vm.chainId(destinationChainId);
        asset = new MockUSDC();
        deployer = new ArcaidiaDeployer();

        // Same circular wiring the real deployment resolves by prediction.
        address predictedFactory =
            deployer.predictAddress(FACTORY_SALT, keccak256(type(ArcaidiaVaultFactory).creationCode));
        market = new ArcaidiaIntentMarket(
            ISettlementCheck(address(new NeverSettledCheck())), IVaultRegistry(predictedFactory)
        );
        factory = ArcaidiaVaultFactory(
            deployer.deploy(
                FACTORY_SALT,
                type(ArcaidiaVaultFactory).creationCode,
                abi.encodeCall(ArcaidiaVaultFactory.initialize, (protocolOwner, address(asset), address(market), receiver))
            )
        );
        assertEq(address(factory), predictedFactory);
    }

    function _create(address creator, bytes32 salt, FeePolicy memory policy) internal returns (ArcaidiaLiquidityVault) {
        vm.prank(creator);
        return ArcaidiaLiquidityVault(factory.createVault(salt, 1_000, 5_000, 8_000, policy, "test vault"));
    }

    function test_anyoneCreatesAVaultTheyOwnWiredToThisChain() public {
        address alice = makeAddr("alice");
        address predicted = factory.predictVault(alice, "a");
        ArcaidiaLiquidityVault v = _create(alice, "a", TestPolicies.tiered());

        assertEq(address(v), predicted, "lands where predicted");
        assertEq(v.owner(), alice, "owned by the creator, not the factory or Arcaidia");
        assertEq(v.market(), address(market));
        assertEq(v.settlementReceiver(), receiver);
        assertEq(address(v.asset()), address(asset));
        assertEq(v.reserveFloorBps(), 1_000);
        assertEq(v.maxFillBps(), 5_000);
        assertEq(v.maxExposureBps(), 8_000);
        (uint16 base,,,,,,) = v.feePolicy();
        assertEq(base, 10);
        assertTrue(factory.isFactoryVault(address(v)));
        assertEq(factory.vaultCount(), 1);
    }

    function test_twoCreatorsSameSaltGetDifferentVaults() public {
        ArcaidiaLiquidityVault a = _create(makeAddr("a"), "x", TestPolicies.tiered());
        ArcaidiaLiquidityVault b = _create(makeAddr("b"), "x", TestPolicies.permissive());
        assertTrue(address(a) != address(b));
        (uint16 baseA,,,,,,) = a.feePolicy();
        (uint16 baseB,,,,,,) = b.feePolicy();
        assertEq(baseA, 10);
        assertEq(baseB, 100, "each vault carries its own policy");
    }

    function test_sameCreatorSameSaltCannotCreateTwice() public {
        _create(makeAddr("a"), "x", TestPolicies.tiered());
        vm.expectRevert();
        _create(makeAddr("a"), "x", TestPolicies.tiered());
    }

    function test_invalidPolicyIsRefusedAtCreation() public {
        FeePolicy memory bad = TestPolicies.tiered();
        bad.midThresholdBps = 9_000; // not ascending
        vm.expectRevert(
            abi.encodeWithSelector(FeePolicyLib.FeePolicyThresholdsNotAscending.selector, 9_000, 7_500, 9_000)
        );
        _create(makeAddr("a"), "bad", bad);
    }

    function test_emitsVaultCreatedWithTheEconomics() public {
        address alice = makeAddr("alice");
        vm.recordLogs();
        ArcaidiaLiquidityVault v = _create(alice, "e", TestPolicies.tiered());

        bytes32 topic = keccak256(
            "VaultCreated(address,address,string,(uint16,uint16,uint16,uint16,uint16,uint16,uint16),uint16,uint16,uint16)"
        );
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == topic) {
                assertEq(address(uint160(uint256(logs[i].topics[1]))), address(v));
                assertEq(address(uint160(uint256(logs[i].topics[2]))), alice);
                (string memory label, FeePolicy memory policy, uint16 floorBps, uint16 fillBps, uint16 exposureBps) =
                    abi.decode(logs[i].data, (string, FeePolicy, uint16, uint16, uint16));
                assertEq(label, "test vault");
                assertEq(policy.criticalFeeBps, 120);
                assertEq(floorBps, 1_000);
                assertEq(fillBps, 5_000);
                assertEq(exposureBps, 8_000);
                found = true;
            }
        }
        assertTrue(found, "VaultCreated not emitted");
    }

    /// D11: the market only admits claims from vaults this factory created.
    function test_marketAdmitsFactoryVaultsAndNobodyElse() public {
        ArcaidiaLiquidityVault v = _create(makeAddr("a"), "m", TestPolicies.tiered());
        assertTrue(factory.isFactoryVault(address(v)));

        address stranger = makeAddr("stranger");
        vm.expectRevert(abi.encodeWithSelector(ArcaidiaIntentMarket.NotAFactoryVault.selector, stranger));
        vm.prank(stranger);
        market.claimIntent(keccak256("i"), 1_000e6, 1e6);

        vm.prank(address(v));
        market.claimIntent(keccak256("i"), 1_000e6, 1e6);
        assertEq(market.filledBy(keccak256("i")), address(v));
    }

    function test_initializeOnce() public {
        vm.expectRevert(ArcaidiaVaultFactory.AlreadyInitialized.selector);
        factory.initialize(makeAddr("x"), address(asset), address(market), receiver);
    }

    function test_predictionIsCreatorSpecificAndChainAgnostic() public {
        address alice = makeAddr("alice");
        address onThisChain = factory.predictVault(alice, "p");
        vm.chainId(sourceChainId);
        assertEq(factory.predictVault(alice, "p"), onThisChain, "depends on factory, creator, salt - never the chain");
        assertTrue(factory.predictVault(makeAddr("bob"), "p") != onThisChain);
    }
}
