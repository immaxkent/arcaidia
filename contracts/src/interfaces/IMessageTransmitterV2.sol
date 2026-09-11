// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IMessageTransmitterV2
/// @notice The subset of Circle's `MessageTransmitterV2` (CCTP V2) that `SettlementReceiver`
///         calls. Verified against github.com/circlefin/evm-cctp-contracts/src/v2/MessageTransmitterV2.sol
///         (2026-09-11): `receiveMessage` enforces the message's `destinationCaller` when it is
///         non-zero and returns `true` on success; `usedNonces` is `1` once a message is received.
interface IMessageTransmitterV2 {
    function receiveMessage(bytes calldata message, bytes calldata attestation) external returns (bool success);
    function usedNonces(bytes32 nonce) external view returns (uint256);
}
