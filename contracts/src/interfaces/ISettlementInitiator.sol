// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title ISettlementInitiator
/// @notice The seam between the router and canonical settlement.
/// @dev The router must commit the user's funds to canonical settlement in the
///      same transaction that records the intent. It does so through this
///      interface so that no Circle-specific call appears in the protocol
///      itself: `MockSettlementInitiator` implements it for tests, and a CCTP
///      implementation replaces it in WP-10 without the router changing.
///
///      The implementation pulls `amount` of `asset` from the caller, so the
///      router approves it immediately before calling.
interface ISettlementInitiator {
    /// @notice Commit funds to canonical settlement toward the destination chain.
    /// @param asset The settlement asset being committed.
    /// @param amount Amount to commit, in the asset's smallest unit.
    /// @param destinationChainId Chain the canonical funds are destined for.
    /// @param destinationReceiver Contract that will receive canonical funds.
    /// @param intentId Correlation key, so settlement can be tied back to the intent.
    /// @return settlementRef Opaque handle identifying the canonical message.
    ///         For CCTP this is derived from the message; consumers treat it as opaque.
    function initiateSettlement(
        address asset,
        uint256 amount,
        uint256 destinationChainId,
        address destinationReceiver,
        bytes32 intentId
    ) external returns (bytes32 settlementRef);

    /// @notice Whether this initiator can currently commit funds toward a chain.
    /// @dev The router checks this before pulling user funds, so a user is never
    ///      left with funds taken and no canonical commitment.
    function supportsDestination(uint256 destinationChainId) external view returns (bool);
}
