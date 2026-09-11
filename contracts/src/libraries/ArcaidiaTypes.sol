// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

// Schema version carried by every `Intent`. Bump only with a new `IntentLib` typehash.
uint8 constant INTENT_VERSION = 1;

// Sentinel for `Intent.tokenOut`: "the destination chain's settlement asset" — USDC, whatever
// its address on that chain. A sentinel rather than the literal USDC address so the intent is
// chain-agnostic, exactly like `sourceChainId`/`destinationChainId`.
address constant USDC_TOKEN_OUT = address(0);

/// @notice The immutable economic terms of a transfer — schema v1.1 (DECISIONS.md D5).
/// @dev Direction is data. `sourceChainId` and `destinationChainId` are ordinary
///      fields; mirroring a transfer is swapping them. No contract in Arcaidia
///      names a specific chain or a specific direction.
///
///      Field order is the `intentId` preimage order (`IntentLib`) and must match
///      `packages/domain/src/intent-id.ts` exactly. `intentVersion` is first so any
///      future layout is distinguishable by its first word; `tokenOut`/`targetMinOut`
///      are last so a USDC-only intent reads as the v1 shape followed by two zeros.
struct Intent {
    uint8 intentVersion;
    address sender;
    address recipient;
    address inputToken;
    uint256 amount;
    uint256 sourceChainId;
    uint256 destinationChainId;
    /// The user's hard ceiling on the fast-fill fee. Enforced on chain by the vault (D6).
    uint16 maxFeeBps;
    uint64 deadline;
    uint256 nonce;
    /// What the recipient ultimately wants on the destination chain. `USDC_TOKEN_OUT` (zero)
    /// for a plain transfer; any other address is a trade intent (Uniswap workstream).
    address tokenOut;
    /// Minimum acceptable `tokenOut` delivered. MUST be 0 when `tokenOut` is the sentinel and
    /// MUST be non-zero otherwise. Unsatisfiable ⇒ the recipient is delivered USDC instead.
    uint256 targetMinOut;
}

/// @notice The narrow, short-lived permission that lets a destination vault pay
///         a recipient from LP inventory.
/// @dev Signed by the agent authority over EIP-712 typed data and verified by
///      the destination `ArcaidiaLiquidityVault`. Everything the vault needs to
///      reject a bad fill is inside it. **Byte layout locked** by a cross-language
///      hash-parity test — the v1.1 intent migration deliberately does not touch it:
///      the vault learns the intent's terms from the `Intent` it is handed alongside
///      this, and binds them through `intentId` (D6).
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

/// @notice A vault's utilisation-tiered fast-fill fee, fixed at initialisation (D7).
/// @dev Step function over `utilisationBps` (advanced principal / total assets):
///        < midThresholdBps                       -> baseFeeBps
///        [midThresholdBps, highThresholdBps)     -> midFeeBps
///        [highThresholdBps, criticalThresholdBps)-> highFeeBps
///        >= criticalThresholdBps                 -> criticalFeeBps
///      Validated by `FeePolicyLib.validate`: thresholds strictly ascending and <= 10_000,
///      fees non-decreasing, `criticalFeeBps <= FeePolicyLib.MAX_FEE_BPS`.
struct FeePolicy {
    uint16 baseFeeBps;
    uint16 midFeeBps;
    uint16 highFeeBps;
    uint16 criticalFeeBps;
    uint16 midThresholdBps;
    uint16 highThresholdBps;
    uint16 criticalThresholdBps;
}
