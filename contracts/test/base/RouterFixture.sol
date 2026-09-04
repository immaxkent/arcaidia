// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ChainFixture} from "./ChainFixture.sol";
import {MockUSDC} from "../../src/mocks/MockUSDC.sol";
import {MockSettlementInitiator} from "../../src/mocks/MockSettlementInitiator.sol";
import {ArcaidiaIntentRouter} from "../../src/ArcaidiaIntentRouter.sol";

/// @notice Shared setup for router suites.
/// @dev Deploys the router on whichever chain the direction fixture nominates
///      as source, by rolling `block.chainid` to it. That is what makes a single
///      suite prove both directions: `test:sc-eth` runs it with Ethereum as
///      source, `test:sc-arc` with Arc as source, and the assertions are identical.
abstract contract RouterFixture is ChainFixture {
    MockUSDC internal asset;
    MockSettlementInitiator internal initiator;
    ArcaidiaIntentRouter internal router;

    address internal deployerOwner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal destinationSettlementReceiver = makeAddr("settlementReceiver");

    uint256 internal constant MAX_INTENT = 50_000e6;
    uint256 internal constant MAX_IN_FLIGHT = 200_000e6;

    function _deployRouter() internal {
        _configureDirection();
        // The router runs on the source chain of the direction under test.
        vm.chainId(sourceChainId);

        asset = new MockUSDC();
        initiator = new MockSettlementInitiator();
        router = new ArcaidiaIntentRouter();

        router.initialize(deployerOwner, address(asset), address(initiator), MAX_INTENT, MAX_IN_FLIGHT);

        vm.prank(deployerOwner);
        router.setDestination(destinationChainId, destinationSettlementReceiver);

        asset.mint(alice, 1_000_000e6);
        vm.prank(alice);
        asset.approve(address(router), type(uint256).max);
    }

    function _defaultDeadline() internal view returns (uint64) {
        return uint64(block.timestamp + 1 hours);
    }

    function _createDefaultIntent(uint256 amount, uint256 nonce) internal returns (bytes32) {
        vm.prank(alice);
        return router.createIntent(bob, amount, destinationChainId, 30, _defaultDeadline(), nonce);
    }
}
