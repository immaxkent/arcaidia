// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ArcaidiaLiquidityVault} from "../../src/ArcaidiaLiquidityVault.sol";
import {IIntentMarket} from "../../src/interfaces/IIntentMarket.sol";

/// @notice Test-only vault exposing the fill accounting without the
///         authorization machinery that arrives in WP-05.
/// @dev The accounting effect of a fast fill — assets leave, exposure rises —
///      is what makes ERC-4626 pricing interesting, and it must be testable
///      before the EIP-712 path exists. This calls the same internal function
///      the real `fastFill` will call, so the accounting under test is the
///      accounting that ships. Never deployed outside tests.
///
///      Also claims through the market first, same as real `fastFill` — since
///      `SettlementReceiver.settle()` now decides LP_REIMBURSED vs
///      RECIPIENT_FALLBACK by asking the market, not this vault, a bypass that
///      skipped the claim would make every "filled" test fixture look unfilled
///      to the receiver. `feeAmount` is fixed at 0: this harness tests
///      accounting, not fee economics, and 0 always clears the market's
///      universal ceiling.
contract VaultHarness is ArcaidiaLiquidityVault {
    function advanceForTest(bytes32 intentId, address recipient, uint256 outputAmount) external {
        IIntentMarket(market).claimIntent(intentId, outputAmount, 0);
        _recordFastFill(intentId, recipient, outputAmount);
    }
}
