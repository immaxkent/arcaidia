// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IntentHookLib} from "../src/libraries/IntentHookLib.sol";

/// @notice Round-trip and vector tests shared with `packages/domain/test/intent-hook.test.ts` (WP-24.4).
contract IntentHookLibTest is Test {
    bytes32 internal constant INTENT_ID = 0x1234567890123456789012345678901234567890123456789012345678901234;
    address internal constant BOB = 0x2222222222222222222222222222222222222222;

    function test_encodesToTheSharedVector() public pure {
        bytes memory encoded = IntentHookLib.encode(INTENT_ID, BOB);
        assertEq(encoded.length, 96);
        assertEq(
            encoded,
            hex"0000000000000000000000000000000000000000000000000000000000000001"
            hex"1234567890123456789012345678901234567890123456789012345678901234"
            hex"0000000000000000000000002222222222222222222222222222222222222222"
        );
    }

    function test_roundTrips() public pure {
        (bytes32 id, address recipient) = IntentHookLib.decode(IntentHookLib.encode(INTENT_ID, BOB));
        assertEq(id, INTENT_ID);
        assertEq(recipient, BOB);
    }

    function testFuzz_roundTrips(bytes32 id, address recipient) public pure {
        (bytes32 outId, address outRecipient) = IntentHookLib.decode(IntentHookLib.encode(id, recipient));
        assertEq(outId, id);
        assertEq(outRecipient, recipient);
    }

    function test_rejectsWrongLength() public {
        vm.expectRevert(abi.encodeWithSelector(IntentHookLib.MalformedIntentHook.selector, 95));
        this.decodeExternal(new bytes(95));
        vm.expectRevert(abi.encodeWithSelector(IntentHookLib.MalformedIntentHook.selector, 0));
        this.decodeExternal("");
    }

    function test_rejectsUnknownVersion() public {
        bytes memory wrongVersion = abi.encode(uint8(2), INTENT_ID, BOB);
        vm.expectRevert(abi.encodeWithSelector(IntentHookLib.UnsupportedIntentHookVersion.selector, 2));
        this.decodeExternal(wrongVersion);
    }

    function decodeExternal(bytes memory data) external pure returns (bytes32, address) {
        return IntentHookLib.decode(data);
    }
}
