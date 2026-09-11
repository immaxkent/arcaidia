// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The immutable economic terms of a transfer.
/// @dev Direction is data. `sourceChainId` and `destinationChainId` are ordinary
///      fields; mirroring a transfer is swapping them. No contract in Arcaidia
///      names a specific chain or a specific direction.
struct Intent {
    address sender;
    address recipient;
    address inputToken;
    uint256 amount;
    uint256 sourceChainId;
    uint256 destinationChainId;
    uint16 maxFeeBps;
    uint64 deadline;
    uint256 nonce;
}

/// @notice The narrow, short-lived permission that lets a destination vault pay
///         a recipient from LP inventory.
/// @dev Signed by the agent authority over EIP-712 typed data and verified by
///      the destination `ArcaidiaLiquidityVault`. Everything the vault needs to
///      reject a bad fill is inside it.
struct FillAuthorization {
    bytes32 intentId;
    uint256 sourceChainId;
    bytes32 sourceTxHash;
    address recipient;
    uint256 inputAmount;
    uint256 outputAmount;
    uint256 feeAmount;
    uint64 expiry;
    uint256 nonce;
}

/// @notice The on-chain-readable half of `Intent`, for a solver to price before bidding.
/// @dev Deliberately not part of `FillAuthorization` — that struct's byte layout is locked by a
///      cross-language hash-parity test (`packages/domain/src/eip712.ts` /
///      `FillAuthorizationLib.sol`), and adding a field here would break every signature ever
///      produced over it. This struct is constructed off-chain (from whatever the caller already
///      trusts as the source of the real `Intent` — today, an agent's own verified observation of
///      the source chain) and passed as plain calldata into `IArcaidiaSolverVault.quote`; nothing
///      in `ArcaidiaIntentMarket` stores it, so there is no on-chain "registry" of opportunities
///      to keep in sync.
struct IntentOpportunity {
    bytes32 intentId;
    uint256 sourceChainId;
    uint256 destinationChainId;
    address recipient;
    uint256 inputAmount;
    uint16 maxFeeBps;
    uint64 deadline;
    bool consumed;
}
