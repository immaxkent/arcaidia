// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ChainFixture} from "./base/ChainFixture.sol";
import {FillAuthorization} from "../src/libraries/ArcaidiaTypes.sol";
import {FillAuthorizationLib} from "../src/libraries/FillAuthorizationLib.sol";

/// @notice Cross-language EIP-712 agreement for fill authorizations.
/// @dev If these diverge, the agent signs one thing and the vault verifies
///      another: every fill fails, or worse, a digest collision authorises
///      something nobody signed.
contract FillAuthorizationTest is ChainFixture {
    address internal constant BOB = 0x2222222222222222222222222222222222222222;
    address internal constant VAULT_A = 0xAAaA000000000000000000000000000000000001;
    address internal constant VAULT_B = 0xBbbb000000000000000000000000000000000002;

    function setUp() public {
        _configureDirection();
    }

    /// The exact fixture from `packages/domain/test/fixtures.ts`.
    function _tsFixture() internal pure returns (FillAuthorization memory) {
        return FillAuthorization({
            intentId: 0x1234567890123456789012345678901234567890123456789012345678901234,
            sourceChainId: 11155111,
            sourceTxHash: 0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd,
            recipient: BOB,
            inputAmount: 1_000_000_000,
            outputAmount: 999_000_000,
            feeAmount: 1_000_000,
            expiry: 1_800_000_060,
            nonce: 1
        });
    }

    function _copy(FillAuthorization memory a) internal pure returns (FillAuthorization memory) {
        return FillAuthorization({
            intentId: a.intentId,
            sourceChainId: a.sourceChainId,
            sourceTxHash: a.sourceTxHash,
            recipient: a.recipient,
            inputAmount: a.inputAmount,
            outputAmount: a.outputAmount,
            feeAmount: a.feeAmount,
            expiry: a.expiry,
            nonce: a.nonce
        });
    }

    // ---------------------------------------------------------------------
    // Cross-language agreement
    // ---------------------------------------------------------------------

    /// Locked against `packages/domain/test/eip712.test.ts`, which asserts the
    /// same constant. A drift in either language fails both suites.
    function test_digestMatchesTypeScriptFixture() public pure {
        assertEq(
            FillAuthorizationLib.digest(_tsFixture(), 5042002, VAULT_A),
            0xdb3d343722290d7551171c7b8df79f6daa35afe6e0669e186622e2ebb73506bc,
            "Solidity and TypeScript EIP-712 digests have diverged"
        );
    }

    function test_typehashMatchesTypeScript() public pure {
        assertEq(
            FillAuthorizationLib.FILL_AUTHORIZATION_TYPEHASH,
            keccak256(
                "FillAuthorization(bytes32 intentId,uint256 sourceChainId,bytes32 sourceTxHash,address recipient,uint256 inputAmount,uint256 outputAmount,uint256 feeAmount,uint64 expiry,uint256 nonce)"
            )
        );
    }

    function test_domainSeparatorUsesArcaidiaVersionOne() public pure {
        bytes32 expected = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("Arcaidia"),
                keccak256("1"),
                uint256(5042002),
                VAULT_A
            )
        );
        assertEq(FillAuthorizationLib.domainSeparator(5042002, VAULT_A), expected);
    }

    // ---------------------------------------------------------------------
    // Replay separation — the sharpest edge in a symmetric deployment
    // ---------------------------------------------------------------------

    /// Arcaidia puts identical vault bytecode at identical addresses on both
    /// chains. Without chainId in the domain, one signature would authorise a
    /// fill on each — the same authorization spent twice against two pools of
    /// LP capital.
    function test_sameVaultAddressOnAnotherChainGivesAnotherDigest() public pure {
        assertTrue(
            FillAuthorizationLib.digest(_tsFixture(), ETHEREUM_SEPOLIA, VAULT_A)
                != FillAuthorizationLib.digest(_tsFixture(), ARC_TESTNET, VAULT_A)
        );
    }

    function test_anotherVaultOnTheSameChainGivesAnotherDigest() public pure {
        assertTrue(
            FillAuthorizationLib.digest(_tsFixture(), ARC_TESTNET, VAULT_A)
                != FillAuthorizationLib.digest(_tsFixture(), ARC_TESTNET, VAULT_B)
        );
    }

    /// Whichever direction is under test, the two chains' digests must differ.
    function test_digestsDifferAcrossTheDirectionUnderTest() public view {
        _assertDirectionConfigured();
        assertTrue(
            FillAuthorizationLib.digest(_tsFixture(), sourceChainId, VAULT_A)
                != FillAuthorizationLib.digest(_tsFixture(), destinationChainId, VAULT_A)
        );
    }

    // ---------------------------------------------------------------------
    // Every field is bound into the digest
    // ---------------------------------------------------------------------

    function _assertFieldBound(FillAuthorization memory mutated) internal pure {
        assertTrue(
            FillAuthorizationLib.digest(mutated, ARC_TESTNET, VAULT_A)
                != FillAuthorizationLib.digest(_tsFixture(), ARC_TESTNET, VAULT_A)
        );
    }

    function test_intentIdIsBound() public pure {
        FillAuthorization memory m = _copy(_tsFixture());
        m.intentId = keccak256("other");
        _assertFieldBound(m);
    }

    function test_sourceChainIdIsBound() public pure {
        FillAuthorization memory m = _copy(_tsFixture());
        m.sourceChainId = 5042002;
        _assertFieldBound(m);
    }

    function test_sourceTxHashIsBound() public pure {
        FillAuthorization memory m = _copy(_tsFixture());
        m.sourceTxHash = keccak256("other tx");
        _assertFieldBound(m);
    }

    function test_recipientIsBound() public pure {
        FillAuthorization memory m = _copy(_tsFixture());
        m.recipient = address(0x3333);
        _assertFieldBound(m);
    }

    function test_inputAmountIsBound() public pure {
        FillAuthorization memory m = _copy(_tsFixture());
        m.inputAmount += 1;
        _assertFieldBound(m);
    }

    function test_outputAmountIsBound() public pure {
        FillAuthorization memory m = _copy(_tsFixture());
        m.outputAmount += 1;
        _assertFieldBound(m);
    }

    function test_feeAmountIsBound() public pure {
        FillAuthorization memory m = _copy(_tsFixture());
        m.feeAmount += 1;
        _assertFieldBound(m);
    }

    function test_expiryIsBound() public pure {
        FillAuthorization memory m = _copy(_tsFixture());
        m.expiry += 1;
        _assertFieldBound(m);
    }

    function test_nonceIsBound() public pure {
        FillAuthorization memory m = _copy(_tsFixture());
        m.nonce += 1;
        _assertFieldBound(m);
    }
}
