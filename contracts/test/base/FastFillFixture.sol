// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VaultFixture} from "./VaultFixture.sol";
import {FillAuthorization, Intent, INTENT_VERSION, USDC_TOKEN_OUT} from "../../src/libraries/ArcaidiaTypes.sol";
import {IntentLib} from "../../src/libraries/IntentLib.sol";

/// @notice Setup for the fill path: an authorised agent key and a signer helper.
/// @dev The agent key here stands in for `LocalAgentSigner`, and later for a
///      Circle Agent Wallet. The vault cannot tell them apart, which is the
///      point of authenticating a recovered signer rather than a caller.
///
///      v2 (WP-26): every authorization is derived from a real `Intent` — the
///      vault recomputes the id from the intent it is handed (D6) — so the
///      fixture keeps the intent behind each id and passes it alongside.
abstract contract FastFillFixture is VaultFixture {
    uint256 internal agentKey;
    address internal agent;

    uint256 internal rogueKey;
    address internal rogue;

    /// @dev The intent behind every authorization this fixture minted, by id.
    mapping(bytes32 => Intent) internal intents;

    // Fill/exposure caps are now a live percentage of totalAssets() (see
    // ArcaidiaLiquidityVault.maxFillAmount/maxOutstandingExposure). These two
    // absolute constants are what that percentage resolves to at this
    // fixture's fixed 100,000e6 baseline deposit below, kept so every existing
    // assertion downstream stays unchanged; MAX_FILL_BPS/MAX_EXPOSURE_BPS are
    // what's actually passed to setFillLimits.
    uint256 internal constant MAX_FILL = 25_000e6;
    uint256 internal constant MAX_EXPOSURE = 60_000e6;
    uint16 internal constant MAX_FILL_BPS = 2_500; // 25% of 100,000e6 == MAX_FILL
    uint16 internal constant MAX_EXPOSURE_BPS = 6_000; // 60% of 100,000e6 == MAX_EXPOSURE
    /// @dev The user's own ceiling on every fixture intent (schema v1.1 `maxFeeBps`) — 1%.
    ///      The vault's permissive policy posts the same 100 bps at low utilisation, so
    ///      both ceilings coincide here; `VaultIntentTerms.t.sol` pulls them apart.
    uint16 internal constant MAX_FEE_BPS = 100;

    function _deployWithAgent() internal {
        _deployVault();

        (agent, agentKey) = makeAddrAndKey("agent");
        (rogue, rogueKey) = makeAddrAndKey("rogue");

        vm.startPrank(vaultOwner);
        vault.setFillLimits(MAX_FILL_BPS, MAX_EXPOSURE_BPS);
        vault.setAuthorisedSigner(agent, true);
        vm.stopPrank();

        _deposit(lpAlice, 100_000e6);
    }

    /// @dev A plain USDC intent of `inputAmount`, created on the *other* chain for this one.
    function _intent(uint256 nonce, uint256 inputAmount) internal view returns (Intent memory) {
        return Intent({
            intentVersion: INTENT_VERSION,
            sender: lpBob,
            recipient: recipient,
            inputToken: address(asset),
            amount: inputAmount,
            sourceChainId: sourceChainId,
            destinationChainId: block.chainid,
            maxFeeBps: MAX_FEE_BPS,
            deadline: uint64(block.timestamp + 1 hours),
            nonce: nonce,
            tokenOut: USDC_TOKEN_OUT,
            targetMinOut: 0
        });
    }

    /// @dev Remember `intent` under its canonical id so `_intentOf` can hand it back.
    function _register(Intent memory intent) internal returns (bytes32 intentId) {
        intentId = IntentLib.computeIntentId(intent);
        intents[intentId] = intent;
    }

    function _intentOf(FillAuthorization memory authorization) internal view returns (Intent memory) {
        return intents[authorization.intentId];
    }

    function _authorization(uint256 nonce, uint256 inputAmount, uint256 feeAmount)
        internal
        returns (FillAuthorization memory)
    {
        return _authorizationFor(_intent(nonce, inputAmount), feeAmount, nonce);
    }

    /// @dev An authorization for an arbitrary (already-built) intent.
    function _authorizationFor(Intent memory intent, uint256 feeAmount, uint256 agentNonce)
        internal
        returns (FillAuthorization memory)
    {
        bytes32 intentId = _register(intent);
        return FillAuthorization({
            intentId: intentId,
            sourceChainId: intent.sourceChainId,
            sourceTxHash: keccak256(abi.encode("tx", intentId)),
            recipient: intent.recipient,
            inputAmount: intent.amount,
            outputAmount: intent.amount - feeAmount,
            feeAmount: feeAmount,
            expiry: uint64(block.timestamp + 45),
            nonce: agentNonce
        });
    }

    function _sign(FillAuthorization memory authorization, uint256 key) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, vault.hashFillAuthorization(authorization));
        return abi.encodePacked(r, s, v);
    }

    function _fill(FillAuthorization memory authorization) internal returns (address) {
        return vault.fastFill(_intentOf(authorization), authorization, _sign(authorization, agentKey));
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
        Intent memory intent = _intentOf(authorization);
        vm.expectRevert(expectedError);
        vault.fastFill(intent, authorization, signature);
    }

    /// @dev Selector overload, for errors that carry no arguments.
    function _fillExpectingRevert(FillAuthorization memory authorization, bytes4 expectedSelector) internal {
        bytes memory signature = _sign(authorization, agentKey);
        Intent memory intent = _intentOf(authorization);
        vm.expectRevert(expectedSelector);
        vault.fastFill(intent, authorization, signature);
    }

    function _fillExpectingAnyRevert(FillAuthorization memory authorization) internal {
        bytes memory signature = _sign(authorization, agentKey);
        Intent memory intent = _intentOf(authorization);
        vm.expectRevert();
        vault.fastFill(intent, authorization, signature);
    }
}
