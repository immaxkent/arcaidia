// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title ReentrantToken
/// @notice A six-decimal ERC-20 that calls back into a target during transfer.
///
/// @dev Real USDC has no transfer hook, but the vault holds a *configured*
///      IERC20 and V2 widens the asset set. A vault whose safety depends on the
///      token being well-behaved is a vault waiting for the first token that
///      is not. This models that adversary: the callback fires mid-transfer,
///      exactly where a naive implementation would still be holding stale state.
contract ReentrantToken is ERC20 {
    address public target;
    bytes public callbackData;
    bool public armed;
    bool public lastCallSucceeded;
    bytes public lastRevertReason;
    uint256 public callbackCount;

    constructor() ERC20("Reentrant USD", "rUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Arm a single callback, fired on the next transfer.
    function arm(address target_, bytes calldata data) external {
        target = target_;
        callbackData = data;
        armed = true;
    }

    function disarm() external {
        armed = false;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);

        if (armed && target != address(0)) {
            // Fire once: a callback that re-armed itself would recurse forever
            // and obscure which guard actually stopped it.
            armed = false;
            callbackCount++;
            (bool ok, bytes memory reason) = target.call(callbackData);
            lastCallSucceeded = ok;
            lastRevertReason = reason;
        }
    }
}
