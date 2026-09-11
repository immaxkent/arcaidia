// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {FeePolicy} from "../../src/libraries/ArcaidiaTypes.sol";

/// @notice Fee policies the suites share.
library TestPolicies {
    /// @dev Flat-ish and generous: every pre-WP-26 assertion about fees (50–100 bps fills at
    ///      0% utilisation) stays valid under it, so those suites keep testing what they
    ///      tested before rather than the policy. Ceiling-bound at the protocol maximum.
    function permissive() internal pure returns (FeePolicy memory) {
        return FeePolicy({
            baseFeeBps: 100,
            midFeeBps: 110,
            highFeeBps: 120,
            criticalFeeBps: 150,
            midThresholdBps: 5_000,
            highThresholdBps: 7_500,
            criticalThresholdBps: 9_000
        });
    }

    /// @dev The plan's proposed House Vault policy: 10/25/60/120 bps at 50/75/90%.
    function tiered() internal pure returns (FeePolicy memory) {
        return FeePolicy({
            baseFeeBps: 10,
            midFeeBps: 25,
            highFeeBps: 60,
            criticalFeeBps: 120,
            midThresholdBps: 5_000,
            highThresholdBps: 7_500,
            criticalThresholdBps: 9_000
        });
    }
}
