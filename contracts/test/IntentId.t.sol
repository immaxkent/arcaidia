// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ChainFixture} from "./base/ChainFixture.sol";
import {Intent} from "../src/libraries/ArcaidiaTypes.sol";
import {IntentLib} from "../src/libraries/IntentLib.sol";

/// @notice Cross-language identity tests for `intentId`.
/// @dev The differential test below is the contract between this repository's
///      Solidity and its TypeScript. If it fails, the agent, the subgraph and
///      the vault have stopped agreeing on what identifies an intent.
contract IntentIdTest is ChainFixture {
    using IntentLib for Intent;

    address internal constant ALICE = 0x1111111111111111111111111111111111111111;
    address internal constant BOB = 0x2222222222222222222222222222222222222222;
    address internal constant SEPOLIA_USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    function setUp() public {
        _configureDirection();
    }

    /// @dev The exact fixture from `packages/domain/test/fixtures.ts`, pinned to
    ///      Ethereum → Arc regardless of the direction under test, because the
    ///      TypeScript fixture is pinned that way too.
    function _tsFixtureIntent() internal pure returns (Intent memory) {
        return Intent({
            sender: ALICE,
            recipient: BOB,
            inputToken: SEPOLIA_USDC,
            amount: 1_000_000_000,
            sourceChainId: 11155111,
            destinationChainId: 5042002,
            maxFeeBps: 30,
            deadline: 1_800_000_000,
            nonce: 7
        });
    }

    function _intentForDirection() internal view returns (Intent memory intent) {
        intent = _tsFixtureIntent();
        intent.sourceChainId = sourceChainId;
        intent.destinationChainId = destinationChainId;
    }

    /// @dev Returns an independent copy. `Intent memory b = a` aliases rather
    ///      than copies in Solidity, so mutating `b` would silently mutate `a`
    ///      and every mutation test would compare a value against itself.
    function _copy(Intent memory intent) internal pure returns (Intent memory) {
        return Intent({
            sender: intent.sender,
            recipient: intent.recipient,
            inputToken: intent.inputToken,
            amount: intent.amount,
            sourceChainId: intent.sourceChainId,
            destinationChainId: intent.destinationChainId,
            maxFeeBps: intent.maxFeeBps,
            deadline: intent.deadline,
            nonce: intent.nonce
        });
    }

    // ---------------------------------------------------------------------
    // Cross-language agreement
    // ---------------------------------------------------------------------

    /// Locked against `packages/domain/test/intent-id.test.ts`. Both languages
    /// assert the same constant, so a drift in either fails both suites.
    function test_matchesTypeScriptFixture() public pure {
        assertEq(
            IntentLib.computeIntentId(_tsFixtureIntent()),
            0xfdff8f70cfc4383e7ce72d188c0ada07df4fefc52fbee57ce54349c621dbb9c8,
            "Solidity and TypeScript intent ids have diverged"
        );
    }

    /// The typehash string must match the TypeScript constant character for
    /// character; the id depends on it.
    function test_typehashMatchesTypeScript() public pure {
        assertEq(
            IntentLib.INTENT_TYPEHASH,
            keccak256(
                "Intent(address sender,address recipient,address inputToken,uint256 amount,uint256 sourceChainId,uint256 destinationChainId,uint16 maxFeeBps,uint64 deadline,uint256 nonce)"
            )
        );
    }

    // ---------------------------------------------------------------------
    // Identity properties, in whichever direction is under test
    // ---------------------------------------------------------------------

    function test_isDeterministic() public view {
        Intent memory intent = _intentForDirection();
        assertEq(IntentLib.computeIntentId(intent), IntentLib.computeIntentId(intent));
    }

    /// Mirroring a transfer must yield a different intent, not the same one.
    function test_directionChangesTheId() public view {
        _assertDirectionConfigured();

        Intent memory forward = _intentForDirection();
        Intent memory reverse = _copy(forward);
        reverse.sourceChainId = forward.destinationChainId;
        reverse.destinationChainId = forward.sourceChainId;

        assertTrue(
            IntentLib.computeIntentId(forward) != IntentLib.computeIntentId(reverse),
            "mirrored intents must not share an id"
        );
    }

    function test_senderChangesTheId() public view {
        Intent memory a = _intentForDirection();
        Intent memory b = _copy(a);
        b.sender = address(0x9999);
        assertTrue(IntentLib.computeIntentId(a) != IntentLib.computeIntentId(b));
    }

    function test_recipientChangesTheId() public view {
        Intent memory a = _intentForDirection();
        Intent memory b = _copy(a);
        b.recipient = address(0x8888);
        assertTrue(IntentLib.computeIntentId(a) != IntentLib.computeIntentId(b));
    }

    function test_inputTokenChangesTheId() public view {
        Intent memory a = _intentForDirection();
        Intent memory b = _copy(a);
        b.inputToken = address(0x7777);
        assertTrue(IntentLib.computeIntentId(a) != IntentLib.computeIntentId(b));
    }

    function test_amountChangesTheId() public view {
        Intent memory a = _intentForDirection();
        Intent memory b = _copy(a);
        b.amount = a.amount + 1;
        assertTrue(IntentLib.computeIntentId(a) != IntentLib.computeIntentId(b));
    }

    function test_maxFeeBpsChangesTheId() public view {
        Intent memory a = _intentForDirection();
        Intent memory b = _copy(a);
        b.maxFeeBps = a.maxFeeBps + 1;
        assertTrue(IntentLib.computeIntentId(a) != IntentLib.computeIntentId(b));
    }

    function test_deadlineChangesTheId() public view {
        Intent memory a = _intentForDirection();
        Intent memory b = _copy(a);
        b.deadline = a.deadline + 1;
        assertTrue(IntentLib.computeIntentId(a) != IntentLib.computeIntentId(b));
    }

    function test_nonceChangesTheId() public view {
        Intent memory a = _intentForDirection();
        Intent memory b = _copy(a);
        b.nonce = a.nonce + 1;
        assertTrue(IntentLib.computeIntentId(a) != IntentLib.computeIntentId(b));
    }

    /// Distinct nonces must give distinct ids for any otherwise-identical
    /// intent: this is the property the router's replay protection relies on.
    function testFuzz_distinctNoncesGiveDistinctIds(uint256 nonceA, uint256 nonceB) public view {
        vm.assume(nonceA != nonceB);

        Intent memory a = _intentForDirection();
        Intent memory b = _copy(a);
        a.nonce = nonceA;
        b.nonce = nonceB;

        assertTrue(IntentLib.computeIntentId(a) != IntentLib.computeIntentId(b));
    }
}
