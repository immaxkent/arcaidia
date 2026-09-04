// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IFillRegistry} from "./interfaces/IFillRegistry.sol";

/// @title SettlementReceiver
/// @notice Destination-side terminus of canonical settlement: receives canonical
///         funds and routes them to whichever party is owed them.
///
/// @dev Two branches, and exactly one of them runs per intent:
///
///      - the intent was fast-filled, so the LP advanced the money and canonical
///        funds reimburse the vault;
///      - nobody fast-filled, so canonical funds pay the recipient directly.
///
///      The second branch is the fallback invariant: Arcaidia is an acceleration
///      layer, not a dependency. If no solver participates, the user still gets
///      paid and funds are never trapped here.
///
///      **V1 trust assumption.** `settle` is restricted to allowlisted reporters
///      rather than proved against the canonical message. Verifying a CCTP
///      message onchain would let this contract derive the amount and recipient
///      itself; V1 does not do that, so an operator supplies them. This is the
///      same disclosed authorised-operator model the vault uses for fills, and
///      it is bounded by the fact that funds can only go to the vault or to the
///      recipient named for an unfilled intent — never to the reporter.
///
///      Constructor takes no arguments, so init code and therefore the CREATE2
///      address are identical on both chains.
contract SettlementReceiver is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Where canonical funds went for a given intent.
    /// @dev Mirrors `CanonicalOutcome` in the shared TypeScript domain package.
    enum Outcome {
        NONE,
        LP_REIMBURSED,
        RECIPIENT_FALLBACK
    }

    address public owner;
    bool public initialized;

    IERC20 public asset;
    IFillRegistry public vault;

    /// @notice Operators permitted to report canonical settlement.
    mapping(address => bool) public isReporter;

    /// @notice Settlement outcome per intent. `NONE` means not yet settled.
    mapping(bytes32 => Outcome) public outcomeOf;

    /// @notice Canonical amount recorded per intent.
    mapping(bytes32 => uint256) public settledAmount;

    event ReceiverInitialized(address owner, address asset, address vault);
    event ReporterSet(address indexed reporter, bool allowed);
    event LpReimbursed(bytes32 indexed intentId, uint256 amount);
    event RecipientPaidByFallback(bytes32 indexed intentId, address indexed recipient, uint256 amount);

    error AlreadyInitialized();
    error NotOwner();
    error NotReporter();
    error ZeroAddress();
    error ZeroAmount();
    error AlreadySettled(bytes32 intentId);
    error InsufficientCanonicalFunds(uint256 requested, uint256 held);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyReporter() {
        if (!isReporter[msg.sender]) revert NotReporter();
        _;
    }

    function initialize(address owner_, address asset_, address vault_) external {
        if (initialized) revert AlreadyInitialized();
        if (owner_ == address(0) || asset_ == address(0) || vault_ == address(0)) revert ZeroAddress();

        initialized = true;
        owner = owner_;
        asset = IERC20(asset_);
        vault = IFillRegistry(vault_);

        emit ReceiverInitialized(owner_, asset_, vault_);
    }

    function setReporter(address reporter, bool allowed) external onlyOwner {
        if (reporter == address(0)) revert ZeroAddress();
        isReporter[reporter] = allowed;
        emit ReporterSet(reporter, allowed);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
    }

    /// @notice Whether canonical settlement has already been recorded.
    /// @dev The settlement worker restarts and retries; it reads this rather
    ///      than relying on its own database, which is never authoritative.
    function isSettled(bytes32 intentId) external view returns (bool) {
        return outcomeOf[intentId] != Outcome.NONE;
    }

    /// @notice Route canonical funds for one intent.
    /// @param intentId The intent being settled.
    /// @param fallbackRecipient Paid only if the intent was never fast-filled.
    /// @param amount Canonical amount to route.
    /// @return outcome Which branch ran.
    function settle(bytes32 intentId, address fallbackRecipient, uint256 amount)
        external
        onlyReporter
        nonReentrant
        returns (Outcome outcome)
    {
        if (amount == 0) revert ZeroAmount();
        // Idempotent by rejection: a retrying worker sees this and treats the
        // intent as done rather than paying twice.
        if (outcomeOf[intentId] != Outcome.NONE) revert AlreadySettled(intentId);

        uint256 held = asset.balanceOf(address(this));
        if (amount > held) revert InsufficientCanonicalFunds(amount, held);

        bool filled = vault.isFilled(intentId);

        // Effects before interactions: the outcome is recorded before any funds
        // move, so a token callback cannot re-enter and settle twice.
        outcome = filled ? Outcome.LP_REIMBURSED : Outcome.RECIPIENT_FALLBACK;
        outcomeOf[intentId] = outcome;
        settledAmount[intentId] = amount;

        if (filled) {
            asset.forceApprove(address(vault), amount);
            vault.recordReimbursement(intentId, amount);
            asset.forceApprove(address(vault), 0);
            emit LpReimbursed(intentId, amount);
        } else {
            if (fallbackRecipient == address(0)) revert ZeroAddress();
            asset.safeTransfer(fallbackRecipient, amount);
            emit RecipientPaidByFallback(intentId, fallbackRecipient, amount);
        }
    }
}
