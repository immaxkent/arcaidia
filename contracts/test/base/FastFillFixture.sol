// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VaultFixture} from "./VaultFixture.sol";
import {FillAuthorization} from "../../src/libraries/ArcaidiaTypes.sol";

/// @notice Setup for the fill path: an authorised agent key and a signer helper.
/// @dev The agent key here stands in for `LocalAgentSigner`, and later for a
///      Circle Agent Wallet. The vault cannot tell them apart, which is the
///      point of authenticating a recovered signer rather than a caller.
abstract contract FastFillFixture is VaultFixture {
    uint256 internal agentKey;
    address internal agent;

    uint256 internal rogueKey;
    address internal rogue;

    uint256 internal constant MAX_FILL = 25_000e6;
    uint256 internal constant MAX_EXPOSURE = 60_000e6;
    uint16 internal constant MAX_FEE_BPS = 100; // 1%

    function _deployWithAgent() internal {
        _deployVault();

        (agent, agentKey) = makeAddrAndKey("agent");
        (rogue, rogueKey) = makeAddrAndKey("rogue");

        vm.startPrank(vaultOwner);
        vault.setFillLimits(MAX_FILL, MAX_EXPOSURE, MAX_FEE_BPS);
        vault.setAuthorisedSigner(agent, true);
        vm.stopPrank();

        _deposit(lpAlice, 100_000e6);
    }

    function _authorization(uint256 nonce, uint256 inputAmount, uint256 feeAmount)
        internal
        view
        returns (FillAuthorization memory)
    {
        return FillAuthorization({
            intentId: keccak256(abi.encode("intent", nonce)),
            // The intent was created on the *other* chain.
            sourceChainId: sourceChainId,
            sourceTxHash: keccak256(abi.encode("tx", nonce)),
            recipient: recipient,
            inputAmount: inputAmount,
            outputAmount: inputAmount - feeAmount,
            feeAmount: feeAmount,
            expiry: uint64(block.timestamp + 45),
            nonce: nonce
        });
    }

    function _sign(FillAuthorization memory authorization, uint256 key) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, vault.hashFillAuthorization(authorization));
        return abi.encodePacked(r, s, v);
    }

    function _fill(FillAuthorization memory authorization) internal returns (address) {
        return vault.fastFill(authorization, _sign(authorization, agentKey));
    }

    /// @dev Signs *before* arming the expectation. `_sign` reads the digest from
    ///      the vault, so a bare `vm.expectRevert()` would otherwise attach to
    ///      that view call and the test would pass without ever reaching
    ///      `fastFill` — a false green on exactly the assertions that protect
    ///      LP capital.
    function _fillExpectingRevert(FillAuthorization memory authorization, bytes memory expectedError)
        internal
    {
        bytes memory signature = _sign(authorization, agentKey);
        vm.expectRevert(expectedError);
        vault.fastFill(authorization, signature);
    }

    /// @dev Selector overload, for errors that carry no arguments.
    function _fillExpectingRevert(FillAuthorization memory authorization, bytes4 expectedSelector) internal {
        bytes memory signature = _sign(authorization, agentKey);
        vm.expectRevert(expectedSelector);
        vault.fastFill(authorization, signature);
    }

    function _fillExpectingAnyRevert(FillAuthorization memory authorization) internal {
        bytes memory signature = _sign(authorization, agentKey);
        vm.expectRevert();
        vault.fastFill(authorization, signature);
    }
}
