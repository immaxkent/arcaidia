// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title ITokenMessengerV2
/// @notice The subset of Circle's real `TokenMessengerV2` (CCTP V2) that
///         `CircleCCTPInitiator` calls.
/// @dev Verified against the deployed source at
///      github.com/circlefin/evm-cctp-contracts/blob/master/src/v2/TokenMessengerV2.sol
///      rather than guessed (re-checked 2026-09-11 for `depositForBurnWithHook`):
///      neither function returns anything; the source-side nonce is not part of
///      the event these functions emit — it lives in the CCTP message body itself,
///      which is why correlation to Circle's attestation API happens by transaction
///      hash, not by nonce; see `SettlementReference.sourceTxHash`.
interface ITokenMessengerV2 {
    /// @notice Deposit and burn tokens for a caller-specified destination domain.
    /// @param amount Amount to burn, in the token's smallest unit.
    /// @param destinationDomain CCTP domain of the destination chain.
    /// @param mintRecipient Address to mint to on the destination domain, as bytes32.
    /// @param burnToken Token to burn on the source domain (must be a token TokenMessenger supports).
    /// @param destinationCaller Address, as bytes32, authorized to call `receiveMessage`
    ///        on the destination domain. `bytes32(0)` means any address may.
    /// @param maxFee Maximum fee to pay on the destination domain, in units of `burnToken`.
    ///        Standard (finalized) transfers are always fee-free, so this is 0 unless
    ///        `minFinalityThreshold` requests a Fast transfer.
    /// @param minFinalityThreshold Minimum finality the message should be attested at.
    ///        1000 (or below) selects a Fast transfer; 2000 selects Standard/finalized.
    function depositForBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold
    ) external;

    /// @notice As `depositForBurn`, with `hookData` appended to the burn message body
    ///         (`BurnMessageV2` offset 228) and therefore covered by the attestation.
    /// @dev Circle requires `hookData.length > 0`; CCTP itself never executes the hook —
    ///      it is data for the destination caller to interpret (`SettlementReceiver`, D8).
    function depositForBurnWithHook(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold,
        bytes calldata hookData
    ) external;
}
