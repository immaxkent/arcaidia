// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {FeePolicy} from "../libraries/ArcaidiaTypes.sol";

/// @title IArcaidiaEventsV2
/// @notice The v2 event schema, frozen in WP-24 before any contract emits it, so the indexer
///         (WP-27), the solver (WP-28) and the frontend (WP-30) build against one declaration.
///         WP-25/26 make the router, vault, factory and receiver emit exactly these.
/// @dev Flat parameters throughout — friendlier to the Nest's ABI-driven SQL views than tuples.
///      Three indexed topics on `IntentCreated`, unchanged from v1, so existing subscriptions
///      keyed by `intentId`/`sender`/`recipient` keep working.
interface IArcaidiaEventsV2 {
    /// Source chain, `ArcaidiaIntentRouter`. Every field a solver needs, no off-chain lookup.
    event IntentCreated(
        bytes32 indexed intentId,
        address indexed sender,
        address indexed recipient,
        uint8 intentVersion,
        address inputToken,
        uint256 amount,
        uint256 sourceChainId,
        uint256 destinationChainId,
        uint16 maxFeeBps,
        uint64 deadline,
        uint256 nonce,
        address tokenOut,
        uint256 targetMinOut,
        bytes32 settlementRef
    );

    /// Destination chain, `ArcaidiaLiquidityVault`. `feeBps` is the tier actually charged.
    event FastFilled(
        bytes32 indexed intentId,
        address indexed recipient,
        address indexed signer,
        uint256 inputAmount,
        uint256 outputAmount,
        uint256 feeAmount,
        uint16 feeBps
    );

    /// Destination chain, `ArcaidiaLiquidityVault` — `tokenOut` delivered through the swap adapter.
    event DeliveredViaSwap(bytes32 indexed intentId, address indexed tokenOut, uint256 amountOut);

    /// Destination chain, `ArcaidiaLiquidityVault` — the adapter reverted or was absent; USDC delivered.
    event SwapFellBack(bytes32 indexed intentId, address indexed tokenOut, uint256 usdcDelivered);

    /// Destination chain, `ArcaidiaVaultFactory`. The vault directory is this event.
    event VaultCreated(
        address indexed vault,
        address indexed owner,
        string label,
        FeePolicy policy,
        uint16 reserveFloorBps,
        uint16 maxFillBps,
        uint16 maxExposureBps
    );

    /// Destination chain, `SettlementReceiver` — routed from Circle-attested bytes (D8).
    event SettledWithProof(bytes32 indexed intentId, uint8 outcome, uint256 amount, bytes32 cctpNonce);

    /// Destination chain, `SettlementReceiver` — the winner's reimbursement reverted; funds parked.
    event HeldForVault(bytes32 indexed intentId, address indexed vault, uint256 amount);
}
