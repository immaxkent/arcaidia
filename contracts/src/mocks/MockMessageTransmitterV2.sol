// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IMessageTransmitterV2} from "../interfaces/IMessageTransmitterV2.sol";
import {MockUSDC} from "./MockUSDC.sol";

/// @title MockMessageTransmitterV2
/// @notice Test double for Circle's `MessageTransmitterV2`, faithful in the three behaviours
///         `SettlementReceiver.settleWithProof` relies on: it enforces `destinationCaller`, it
///         refuses a nonce twice, and on success it mints `amount - feeExecuted` to the
///         `mintRecipient` named in the burn body — exactly what the real contract does via
///         `TokenMinterV2`. The "attestation" it accepts is `keccak256(message)`; anything else
///         is rejected, so a test can prove the receiver acts only on an accepted message.
///         `encodeMessage` builds a byte-exact V2 message so the same layout `CctpMessageLib`
///         parses is the one being produced.
contract MockMessageTransmitterV2 is IMessageTransmitterV2 {
    MockUSDC public immutable asset;
    mapping(bytes32 => uint256) public usedNonces;
    bool public shouldReject;

    error InvalidCaller(address expected, address actual);
    error NonceAlreadyUsed(bytes32 nonce);
    error InvalidAttestation();
    error Rejected();

    constructor(MockUSDC asset_) {
        asset = asset_;
    }

    function setShouldReject(bool value) external {
        shouldReject = value;
    }

    function receiveMessage(bytes calldata message, bytes calldata attestation) external returns (bool) {
        if (shouldReject) revert Rejected();
        if (attestation.length != 32 || bytes32(attestation) != keccak256(message)) revert InvalidAttestation();

        bytes32 nonce = bytes32(message[12:44]);
        address destinationCaller = address(uint160(uint256(bytes32(message[108:140]))));
        if (destinationCaller != address(0) && destinationCaller != msg.sender) {
            revert InvalidCaller(destinationCaller, msg.sender);
        }
        if (usedNonces[nonce] != 0) revert NonceAlreadyUsed(nonce);
        usedNonces[nonce] = 1;

        bytes calldata body = message[148:];
        address mintRecipient = address(uint160(uint256(bytes32(body[36:68]))));
        uint256 amount = uint256(bytes32(body[68:100]));
        uint256 feeExecuted = uint256(bytes32(body[164:196]));
        asset.mint(mintRecipient, amount - feeExecuted);
        return true;
    }

    /// @notice The attestation this mock accepts for `message`.
    function attest(bytes memory message) external pure returns (bytes memory) {
        return abi.encodePacked(keccak256(message));
    }

    struct MessageSpec {
        uint32 sourceDomain;
        uint32 destinationDomain;
        bytes32 nonce;
        address recipient;
        address destinationCaller;
        address burnToken;
        address mintRecipient;
        uint256 amount;
        uint256 feeExecuted;
        bytes hookData;
    }

    /// @notice Build a byte-exact CCTP V2 message with a `BurnMessageV2` body.
    function encodeMessage(MessageSpec memory m) external pure returns (bytes memory) {
        uint32 sourceDomain = m.sourceDomain;
        uint32 destinationDomain = m.destinationDomain;
        bytes32 nonce = m.nonce;
        address recipient = m.recipient;
        address destinationCaller = m.destinationCaller;
        address burnToken = m.burnToken;
        address mintRecipient = m.mintRecipient;
        uint256 amount = m.amount;
        uint256 feeExecuted = m.feeExecuted;
        bytes memory hookData = m.hookData;
        bytes memory body = abi.encodePacked(
            uint32(1),
            bytes32(uint256(uint160(burnToken))),
            bytes32(uint256(uint160(mintRecipient))),
            amount,
            bytes32(0), // messageSender
            uint256(0), // maxFee
            feeExecuted,
            uint256(0), // expirationBlock
            hookData
        );
        return abi.encodePacked(
            uint32(1),
            sourceDomain,
            destinationDomain,
            nonce,
            bytes32(0), // sender (the source TokenMessenger)
            bytes32(uint256(uint160(recipient))),
            bytes32(uint256(uint160(destinationCaller))),
            uint32(2000), // minFinalityThreshold
            uint32(2000), // finalityThresholdExecuted
            body
        );
    }
}
