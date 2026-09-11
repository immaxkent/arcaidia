// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {FeePolicy} from "./ArcaidiaTypes.sol";

/// @title FeePolicyLib
/// @notice The one implementation of a vault's fee tier lookup (DECISIONS.md D7).
/// @dev Must produce the same result as `feeBpsAt` in `packages/domain/src/fee-policy.ts`
///      at every boundary; `test/FeePolicyLib.t.sol` and the TypeScript suite share vectors.
library FeePolicyLib {
    uint16 internal constant BPS_DENOMINATOR = 10_000;

    /// @notice The protocol-wide worst case a user is guaranteed regardless of which vault
    ///         wins — the same number `ArcaidiaIntentMarket.MAX_FEE_BPS` enforces. A policy's
    ///         `criticalFeeBps` may not exceed it, so a vault can never *post* a price the
    ///         market would refuse.
    uint16 internal constant MAX_FEE_BPS = 150;

    error FeePolicyThresholdsNotAscending(uint16 mid, uint16 high, uint16 critical);
    error FeePolicyThresholdAboveDenominator(uint16 threshold);
    error FeePolicyFeesNotMonotonic(uint16 base, uint16 mid, uint16 high, uint16 critical);
    error FeePolicyAboveProtocolCeiling(uint16 criticalFeeBps, uint16 ceiling);

    /// @notice Revert unless `policy` is well-formed. Called once, at vault initialisation.
    function validate(FeePolicy memory policy) internal pure {
        if (
            !(policy.midThresholdBps < policy.highThresholdBps
                && policy.highThresholdBps < policy.criticalThresholdBps)
        ) {
            revert FeePolicyThresholdsNotAscending(
                policy.midThresholdBps, policy.highThresholdBps, policy.criticalThresholdBps
            );
        }
        if (policy.criticalThresholdBps > BPS_DENOMINATOR) {
            revert FeePolicyThresholdAboveDenominator(policy.criticalThresholdBps);
        }
        if (
            !(policy.baseFeeBps <= policy.midFeeBps && policy.midFeeBps <= policy.highFeeBps
                && policy.highFeeBps <= policy.criticalFeeBps)
        ) {
            revert FeePolicyFeesNotMonotonic(
                policy.baseFeeBps, policy.midFeeBps, policy.highFeeBps, policy.criticalFeeBps
            );
        }
        if (policy.criticalFeeBps > MAX_FEE_BPS) {
            revert FeePolicyAboveProtocolCeiling(policy.criticalFeeBps, MAX_FEE_BPS);
        }
    }

    /// @notice The fee tier that applies at `utilisationBps`.
    function feeBpsAt(FeePolicy memory policy, uint256 utilisationBps) internal pure returns (uint16) {
        if (utilisationBps >= policy.criticalThresholdBps) return policy.criticalFeeBps;
        if (utilisationBps >= policy.highThresholdBps) return policy.highFeeBps;
        if (utilisationBps >= policy.midThresholdBps) return policy.midFeeBps;
        return policy.baseFeeBps;
    }

    /// @notice Fee amount for `inputAmount` at `feeBps`, rounded up in the vault's favour —
    ///         the same rounding `feeAmountFor` uses in `packages/agent/src/risk/fee.ts`.
    function feeAmountFor(uint256 inputAmount, uint16 feeBps) internal pure returns (uint256) {
        uint256 numerator = inputAmount * feeBps;
        uint256 floor = numerator / BPS_DENOMINATOR;
        return numerator % BPS_DENOMINATOR == 0 ? floor : floor + 1;
    }
}
