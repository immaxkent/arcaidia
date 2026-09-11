// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {FeePolicy} from "../src/libraries/ArcaidiaTypes.sol";
import {FeePolicyLib} from "../src/libraries/FeePolicyLib.sol";

/// @notice Boundary vectors shared with `packages/domain/test/fee-policy.test.ts` (WP-24.3).
contract FeePolicyLibTest is Test {
    function _policy() internal pure returns (FeePolicy memory) {
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

    /// The same table the TypeScript suite asserts: (utilisationBps, feeBps).
    function test_boundaryVectors() public pure {
        FeePolicy memory p = _policy();
        assertEq(FeePolicyLib.feeBpsAt(p, 0), 10);
        assertEq(FeePolicyLib.feeBpsAt(p, 4_999), 10);
        assertEq(FeePolicyLib.feeBpsAt(p, 5_000), 25);
        assertEq(FeePolicyLib.feeBpsAt(p, 7_499), 25);
        assertEq(FeePolicyLib.feeBpsAt(p, 7_500), 60);
        assertEq(FeePolicyLib.feeBpsAt(p, 8_999), 60);
        assertEq(FeePolicyLib.feeBpsAt(p, 9_000), 120);
        assertEq(FeePolicyLib.feeBpsAt(p, 10_000), 120);
        // Utilisation can never exceed 100% on chain, but the lookup must not misbehave if asked.
        assertEq(FeePolicyLib.feeBpsAt(p, 12_345), 120);
    }

    function test_validAtTheExtremes() public pure {
        FeePolicyLib.validate(_policy());
        FeePolicyLib.validate(
            FeePolicy({
                baseFeeBps: 0,
                midFeeBps: 0,
                highFeeBps: 0,
                criticalFeeBps: 0,
                midThresholdBps: 0,
                highThresholdBps: 1,
                criticalThresholdBps: 10_000
            })
        );
        FeePolicyLib.validate(
            FeePolicy({
                baseFeeBps: 150,
                midFeeBps: 150,
                highFeeBps: 150,
                criticalFeeBps: 150,
                midThresholdBps: 1,
                highThresholdBps: 2,
                criticalThresholdBps: 3
            })
        );
    }

    function test_rejectsNonAscendingThresholds() public {
        FeePolicy memory p = _policy();
        p.highThresholdBps = p.midThresholdBps;
        vm.expectRevert(
            abi.encodeWithSelector(
                FeePolicyLib.FeePolicyThresholdsNotAscending.selector, 5_000, 5_000, 9_000
            )
        );
        this.validateExternal(p);
    }

    function test_rejectsThresholdAboveDenominator() public {
        FeePolicy memory p = _policy();
        p.criticalThresholdBps = 10_001;
        vm.expectRevert(
            abi.encodeWithSelector(FeePolicyLib.FeePolicyThresholdAboveDenominator.selector, 10_001)
        );
        this.validateExternal(p);
    }

    function test_rejectsDecreasingFees() public {
        FeePolicy memory p = _policy();
        p.highFeeBps = 20; // below midFeeBps
        vm.expectRevert(
            abi.encodeWithSelector(FeePolicyLib.FeePolicyFeesNotMonotonic.selector, 10, 25, 20, 120)
        );
        this.validateExternal(p);
    }

    function test_rejectsCriticalFeeAboveProtocolCeiling() public {
        FeePolicy memory p = _policy();
        p.criticalFeeBps = 151;
        vm.expectRevert(
            abi.encodeWithSelector(FeePolicyLib.FeePolicyAboveProtocolCeiling.selector, 151, 150)
        );
        this.validateExternal(p);
    }

    function test_feeAmountRoundsUpInTheVaultsFavour() public pure {
        assertEq(FeePolicyLib.feeAmountFor(1_000_000_000, 30), 3_000_000);
        assertEq(FeePolicyLib.feeAmountFor(1, 1), 1); // 0.0001 rounds up to 1 wei
        assertEq(FeePolicyLib.feeAmountFor(10_000, 1), 1);
        assertEq(FeePolicyLib.feeAmountFor(10_001, 1), 2);
        assertEq(FeePolicyLib.feeAmountFor(123_456, 0), 0);
    }

    function testFuzz_feeIsMonotonicInUtilisation(uint16 a, uint16 b) public pure {
        vm.assume(a <= b);
        FeePolicy memory p = _policy();
        assertLe(FeePolicyLib.feeBpsAt(p, a), FeePolicyLib.feeBpsAt(p, b));
    }

    /// Library `internal pure` reverts need an external frame for `vm.expectRevert`.
    function validateExternal(FeePolicy memory p) external pure {
        FeePolicyLib.validate(p);
    }
}
