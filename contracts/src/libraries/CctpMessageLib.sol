// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title CctpMessageLib
/// @notice Read-only view over a CCTP V2 message carrying a `BurnMessageV2` body.
/// @dev Offsets verified against circlefin/evm-cctp-contracts `MessageV2.sol` and
///      `BurnMessageV2.sol` (2026-09-11):
///
///        MessageV2      version 0 · sourceDomain 4 · destinationDomain 8 · nonce 12 · sender 44 ·
///                       recipient 76 · destinationCaller 108 · minFinalityThreshold 140 ·
///                       finalityThresholdExecuted 144 · messageBody 148
///        BurnMessageV2  version 0 · burnToken 4 · mintRecipient 36 · amount 68 · messageSender 100 ·
///                       maxFee 132 · feeExecuted 164 · expirationBlock 196 · hookData 228
///
///      This library never validates the attestation — `MessageTransmitterV2.receiveMessage`
///      does that, and `SettlementReceiver` only acts on a message that call has accepted.
library CctpMessageLib {
    uint256 internal constant NONCE_INDEX = 12;
    uint256 internal constant RECIPIENT_INDEX = 76;
    uint256 internal constant DESTINATION_CALLER_INDEX = 108;
    uint256 internal constant BODY_INDEX = 148;

    uint256 internal constant BODY_MINT_RECIPIENT_INDEX = 36;
    uint256 internal constant BODY_AMOUNT_INDEX = 68;
    uint256 internal constant BODY_FEE_EXECUTED_INDEX = 164;
    uint256 internal constant BODY_HOOK_DATA_INDEX = 228;

    uint256 internal constant MIN_LENGTH = BODY_INDEX + BODY_HOOK_DATA_INDEX;

    struct Parsed {
        bytes32 nonce;
        address recipient;
        address destinationCaller;
        address mintRecipient;
        uint256 amount;
        uint256 feeExecuted;
        bytes hookData;
    }

    error CctpMessageTooShort(uint256 length);

    function parse(bytes calldata message) internal pure returns (Parsed memory parsed) {
        if (message.length < MIN_LENGTH) revert CctpMessageTooShort(message.length);

        parsed.nonce = bytes32(message[NONCE_INDEX:NONCE_INDEX + 32]);
        parsed.recipient = _addressAt(message, RECIPIENT_INDEX);
        parsed.destinationCaller = _addressAt(message, DESTINATION_CALLER_INDEX);

        bytes calldata body = message[BODY_INDEX:];
        parsed.mintRecipient = _addressAt(body, BODY_MINT_RECIPIENT_INDEX);
        parsed.amount = uint256(bytes32(body[BODY_AMOUNT_INDEX:BODY_AMOUNT_INDEX + 32]));
        parsed.feeExecuted = uint256(bytes32(body[BODY_FEE_EXECUTED_INDEX:BODY_FEE_EXECUTED_INDEX + 32]));
        parsed.hookData = body[BODY_HOOK_DATA_INDEX:];
    }

    /// @dev CCTP stores addresses as left-padded bytes32.
    function _addressAt(bytes calldata data, uint256 index) private pure returns (address) {
        return address(uint160(uint256(bytes32(data[index:index + 32]))));
    }
}
