// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ChainFixture} from "./base/ChainFixture.sol";
import {Intent, INTENT_VERSION, USDC_TOKEN_OUT} from "../src/libraries/ArcaidiaTypes.sol";
import {IntentLib} from "../src/libraries/IntentLib.sol";

/// @notice Cross-language identity tests for `intentId` — schema v1.1 (WP-24).
/// @dev The differential vectors below are the contract between this repository's
///      Solidity and its TypeScript (`packages/domain/test/intent-id.test.ts`). If
///      one fails, the agent, the indexer, the vault's on-chain `maxFeeBps` check
///      (D6) and the CCTP hook (D8) have stopped agreeing on what identifies an intent.
contract IntentIdTest is ChainFixture {
    using IntentLib for Intent;

    address internal constant ALICE = 0x1111111111111111111111111111111111111111;
    address internal constant BOB = 0x2222222222222222222222222222222222222222;
    address internal constant MOCK_ETH = 0x3333333333333333333333333333333333333333;
    address internal constant SEPOLIA_USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    // Shared with `packages/domain/test/fixtures.ts` — same literal values, same expected ids.
    bytes32 internal constant VECTOR_USDC_ONLY =
        0x96a1a2a472816b5990818f5a89d5361bf32bf255bcad23bf64f22e7237948058;
    bytes32 internal constant VECTOR_TRADE =
        0xa8d935eff12a337ede5edcee94b93b4a9e756b9a905b1e36bbd034cdf0847f69;
    bytes32 internal constant VECTOR_MIRRORED =
        0xb6997a5c7162d9164d132aaa1880e73da582684ff1fbe10ee3b8875e084d1cf2;
    bytes32 internal constant VECTOR_MAX_WIDTH =
        0x68544c72f88d746145b4da20edb9affbd08cee1680c9b93f442d20ecd3461e39;

    function setUp() public {
        _configureDirection();
    }

    /// @dev The exact fixture from `packages/domain/test/fixtures.ts`, pinned to
    ///      Ethereum → Arc regardless of the direction under test, because the
    ///      TypeScript fixture is pinned that way too.
    function _tsFixtureIntent() internal pure returns (Intent memory) {
        return Intent({
            intentVersion: INTENT_VERSION,
            sender: ALICE,
            recipient: BOB,
            inputToken: SEPOLIA_USDC,
            amount: 1_000_000_000,
            sourceChainId: 11155111,
            destinationChainId: 5042002,
            maxFeeBps: 30,
            deadline: 1_800_000_000,
            nonce: 7,
            tokenOut: USDC_TOKEN_OUT,
            targetMinOut: 0
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
            intentVersion: intent.intentVersion,
            sender: intent.sender,
            recipient: intent.recipient,
            inputToken: intent.inputToken,
            amount: intent.amount,
            sourceChainId: intent.sourceChainId,
            destinationChainId: intent.destinationChainId,
            maxFeeBps: intent.maxFeeBps,
            deadline: intent.deadline,
            nonce: intent.nonce,
            tokenOut: intent.tokenOut,
            targetMinOut: intent.targetMinOut
        });
    }

    // ---------------------------------------------------------------------
    // Cross-language agreement — four vectors, literal on both sides
    // ---------------------------------------------------------------------

    function test_vector_usdcOnlyMatchesTypeScript() public pure {
        assertEq(IntentLib.computeIntentId(_tsFixtureIntent()), VECTOR_USDC_ONLY, "usdc-only vector diverged");
    }

    function test_vector_tradeIntentMatchesTypeScript() public pure {
        Intent memory intent = _tsFixtureIntent();
        intent.tokenOut = MOCK_ETH;
        intent.targetMinOut = 250_000_000_000_000_000; // 0.25 MockETH at 18 decimals
        assertEq(IntentLib.computeIntentId(intent), VECTOR_TRADE, "trade vector diverged");
    }

    function test_vector_mirroredDirectionMatchesTypeScript() public pure {
        Intent memory intent = _tsFixtureIntent();
        intent.sourceChainId = 5042002;
        intent.destinationChainId = 11155111;
        assertEq(IntentLib.computeIntentId(intent), VECTOR_MIRRORED, "mirrored vector diverged");
    }

    /// Every width-sensitive field at its maximum: proves the uint widths in the
    /// typehash (uint8 / uint16 / uint64 / uint256) are what both sides encode.
    function test_vector_maxWidthMatchesTypeScript() public pure {
        Intent memory intent = _tsFixtureIntent();
        intent.amount = type(uint256).max;
        intent.nonce = type(uint256).max;
        intent.tokenOut = MOCK_ETH;
        intent.targetMinOut = type(uint256).max;
        intent.maxFeeBps = 10_000;
        intent.deadline = 9007199254740991; // JS Number.MAX_SAFE_INTEGER — the TS side's exact ceiling
        assertEq(IntentLib.computeIntentId(intent), VECTOR_MAX_WIDTH, "max-width vector diverged");
    }

    /// The typehash string must match the TypeScript constant character for
    /// character; the id depends on it.
    function test_typehashMatchesTypeScript() public pure {
        assertEq(
            IntentLib.INTENT_TYPEHASH,
            0x2c6674d90e5d54fba3347fed0eff5641e7395a761cecbf27dfe3d41b36fa413e,
            "typehash diverged from packages/domain/src/intent-id.ts"
        );
        assertEq(
            IntentLib.INTENT_TYPEHASH,
            keccak256(
                "Intent(uint8 intentVersion,address sender,address recipient,address inputToken,uint256 amount,uint256 sourceChainId,uint256 destinationChainId,uint16 maxFeeBps,uint64 deadline,uint256 nonce,address tokenOut,uint256 targetMinOut)"
            )
        );
    }

    /// The two-`abi.encode` concatenation in `IntentLib` must equal one flat encode.
    function test_concatenatedEncodingEqualsSingleEncode() public pure {
        Intent memory i = _tsFixtureIntent();
        bytes32 flat = keccak256(
            abi.encode(
                IntentLib.INTENT_TYPEHASH,
                i.intentVersion,
                i.sender,
                i.recipient,
                i.inputToken,
                i.amount,
                i.sourceChainId,
                i.destinationChainId,
                i.maxFeeBps,
                i.deadline,
                i.nonce,
                i.tokenOut,
                i.targetMinOut
            )
        );
        assertEq(IntentLib.computeIntentId(i), flat);
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

    function test_intentVersionChangesTheId() public view {
        Intent memory a = _intentForDirection();
        Intent memory b = _copy(a);
        b.intentVersion = a.intentVersion + 1;
        assertTrue(IntentLib.computeIntentId(a) != IntentLib.computeIntentId(b));
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

    /// A trade intent is a different intent from the USDC-only transfer of the
    /// same amount: the vault's on-chain check (D6) relies on `tokenOut` and
    /// `targetMinOut` being bound into the id, not carried loose beside it.
    function test_tokenOutChangesTheId() public view {
        Intent memory a = _intentForDirection();
        Intent memory b = _copy(a);
        b.tokenOut = MOCK_ETH;
        b.targetMinOut = 1;
        assertTrue(IntentLib.computeIntentId(a) != IntentLib.computeIntentId(b));
    }

    function test_targetMinOutChangesTheId() public view {
        Intent memory a = _intentForDirection();
        a.tokenOut = MOCK_ETH;
        a.targetMinOut = 100;
        Intent memory b = _copy(a);
        b.targetMinOut = 101;
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
