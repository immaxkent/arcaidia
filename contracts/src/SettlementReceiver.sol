// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IFillRegistry} from "./interfaces/IFillRegistry.sol";
import {IIntentMarket} from "./interfaces/IIntentMarket.sol";
import {IMessageTransmitterV2} from "./interfaces/IMessageTransmitterV2.sol";
import {CctpMessageLib} from "./libraries/CctpMessageLib.sol";
import {IntentHookLib} from "./libraries/IntentHookLib.sol";

/// @title SettlementReceiver
/// @notice Destination-side terminus of canonical settlement: receives canonical
///         funds and routes them to whichever party is owed them.
///
/// @dev Two branches, and exactly one of them runs per intent:
///
///      - the intent was fast-filled, so *some* LP advanced the money and canonical
///        funds reimburse whichever vault the market says actually won it;
///      - nobody fast-filled, so canonical funds pay the recipient directly.
///
///      The second branch is the fallback invariant: Arcaidia is an acceleration
///      layer, not a dependency. If no solver participates, the user still gets
///      paid and funds are never trapped here.
///
///      **v2 (WP-26, DECISIONS.md D8): settlement from attested bytes.** The router
///      commits `(intentId, recipient)` into the CCTP burn message's `hookData` and names
///      this contract as the message's `destinationCaller`. `settleWithProof` — permissionless,
///      needing only the public message and attestation — calls `MessageTransmitterV2.
///      receiveMessage` itself (only it can), checks that exactly the burnt amount was minted
///      here, and routes by the `intentId` and `recipient` Circle attested. The reporter's
///      asserted amount and recipient of V1 are gone from this path; what remains reporter-gated
///      (`settle`) is an owner-operated recovery valve for messages that predate the hook.
///
///      **Reimbursement is market-driven, not vault-fixed.** `ArcaidiaIntentMarket.filledBy`
///      names the winner; the market only ever admits factory-created standard vaults (D11),
///      whose `recordReimbursement` accepts funds solely for intents they actually paid. Should
///      that call revert anyway, the funds are parked as `HELD_FOR_VAULT` and `retryHeld` is
///      permissionless — canonical funds are never trapped and never mis-routed.
///
///      Constructor takes no arguments, so init code and therefore the CREATE2
///      address are identical on both chains.
contract SettlementReceiver is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Where canonical funds went for a given intent.
    /// @dev Mirrors `CanonicalOutcome` in the shared TypeScript domain package, plus the
    ///      transient `HELD_FOR_VAULT` (funds parked here for a winner whose reimbursement
    ///      reverted; resolved to `LP_REIMBURSED` by `retryHeld`).
    enum Outcome {
        NONE,
        LP_REIMBURSED,
        RECIPIENT_FALLBACK,
        HELD_FOR_VAULT
    }

    address public owner;
    bool public initialized;

    IERC20 public asset;
    IIntentMarket public market;
    IMessageTransmitterV2 public messageTransmitter;

    /// @notice Operators permitted to report canonical settlement through the legacy path.
    mapping(address => bool) public isReporter;

    /// @notice Settlement outcome per intent. `NONE` means not yet settled.
    mapping(bytes32 => Outcome) public outcomeOf;

    /// @notice Canonical amount recorded per intent.
    mapping(bytes32 => uint256) public settledAmount;

    /// @notice The vault owed parked funds, per intent in `HELD_FOR_VAULT`.
    mapping(bytes32 => address) public heldFor;

    event ReceiverInitialized(address owner, address asset, address market, address messageTransmitter);
    event ReporterSet(address indexed reporter, bool allowed);
    event LpReimbursed(bytes32 indexed intentId, address indexed vault, uint256 amount);
    event RecipientPaidByFallback(bytes32 indexed intentId, address indexed recipient, uint256 amount);
    event SettledWithProof(bytes32 indexed intentId, uint8 outcome, uint256 amount, bytes32 cctpNonce);
    event HeldForVault(bytes32 indexed intentId, address indexed vault, uint256 amount);

    error AlreadyInitialized();
    error NotOwner();
    error NotReporter();
    error ZeroAddress();
    error ZeroAmount();
    error AlreadySettled(bytes32 intentId);
    error InsufficientCanonicalFunds(uint256 requested, uint256 held);
    error MessageNotForThisReceiver(address recipient, address mintRecipient);
    error MessageNotAccepted();
    error MintedAmountMismatch(uint256 expected, uint256 actual);
    error NothingHeld(bytes32 intentId);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyReporter() {
        if (!isReporter[msg.sender]) revert NotReporter();
        _;
    }

    function initialize(address owner_, address asset_, address market_, address messageTransmitter_) external {
        if (initialized) revert AlreadyInitialized();
        if (
            owner_ == address(0) || asset_ == address(0) || market_ == address(0)
                || messageTransmitter_ == address(0)
        ) revert ZeroAddress();

        initialized = true;
        owner = owner_;
        asset = IERC20(asset_);
        market = IIntentMarket(market_);
        messageTransmitter = IMessageTransmitterV2(messageTransmitter_);

        emit ReceiverInitialized(owner_, asset_, market_, messageTransmitter_);
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

    // -----------------------------------------------------------------------
    // v2: settlement from attested bytes (D8)
    // -----------------------------------------------------------------------

    /// @notice Receive one CCTP message here and route the canonical funds it carries.
    /// @dev Permissionless: the only inputs are Circle's public message and attestation, and
    ///      `receiveMessage` is what decides whether they are genuine. Everything routed is
    ///      derived from the accepted message — never from the caller.
    function settleWithProof(bytes calldata message, bytes calldata attestation)
        external
        nonReentrant
        returns (Outcome outcome)
    {
        CctpMessageLib.Parsed memory parsed = CctpMessageLib.parse(message);
        if (parsed.recipient != address(this) || parsed.mintRecipient != address(this)) {
            revert MessageNotForThisReceiver(parsed.recipient, parsed.mintRecipient);
        }
        (bytes32 intentId, address recipient) = IntentHookLib.decode(parsed.hookData);
        if (outcomeOf[intentId] != Outcome.NONE) revert AlreadySettled(intentId);

        uint256 before = asset.balanceOf(address(this));
        if (!messageTransmitter.receiveMessage(message, attestation)) revert MessageNotAccepted();
        uint256 minted = asset.balanceOf(address(this)) - before;
        uint256 expected = parsed.amount - parsed.feeExecuted;
        if (minted != expected) revert MintedAmountMismatch(expected, minted);
        if (minted == 0) revert ZeroAmount();

        outcome = _route(intentId, recipient, minted);
        emit SettledWithProof(intentId, uint8(outcome), minted, parsed.nonce);
    }

    /// @notice Retry reimbursing a winner whose `recordReimbursement` reverted. Anyone may call.
    function retryHeld(bytes32 intentId) external nonReentrant {
        if (outcomeOf[intentId] != Outcome.HELD_FOR_VAULT) revert NothingHeld(intentId);
        address vault = heldFor[intentId];
        uint256 amount = settledAmount[intentId];

        outcomeOf[intentId] = Outcome.LP_REIMBURSED;
        delete heldFor[intentId];

        asset.forceApprove(vault, amount);
        IFillRegistry(vault).recordReimbursement(intentId, amount);
        asset.forceApprove(vault, 0);
        emit LpReimbursed(intentId, vault, amount);
    }

    // -----------------------------------------------------------------------
    // v1 path: reporter-asserted settlement (recovery valve)
    // -----------------------------------------------------------------------

    /// @notice Route canonical funds for one intent, as reported by an allowlisted operator.
    /// @dev Retained for messages that carry no intent hook (none are produced by the v2
    ///      router) and as an owner-operated recovery path. Bounded exactly as in V1: funds can
    ///      only go to the market's winner or to the named recipient — never to the reporter.
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

        outcome = _route(intentId, fallbackRecipient, amount);
    }

    /// @dev Effects before interactions: the outcome is recorded before any funds move, so a
    ///      token callback cannot re-enter and settle twice. The winner's reimbursement is
    ///      attempted, not assumed: a revert parks the funds rather than trapping them.
    function _route(bytes32 intentId, address fallbackRecipient, uint256 amount) private returns (Outcome outcome) {
        // The market, not any one vault, is authoritative for "who won" — a fixed vault
        // reference cannot answer this once many independently-deployed vaults compete.
        address winner = market.filledBy(intentId);

        settledAmount[intentId] = amount;

        if (winner != address(0)) {
            outcomeOf[intentId] = Outcome.LP_REIMBURSED;
            asset.forceApprove(winner, amount);
            try IFillRegistry(winner).recordReimbursement(intentId, amount) {
                asset.forceApprove(winner, 0);
                emit LpReimbursed(intentId, winner, amount);
                return Outcome.LP_REIMBURSED;
            } catch {
                asset.forceApprove(winner, 0);
                outcomeOf[intentId] = Outcome.HELD_FOR_VAULT;
                heldFor[intentId] = winner;
                emit HeldForVault(intentId, winner, amount);
                return Outcome.HELD_FOR_VAULT;
            }
        }

        if (fallbackRecipient == address(0)) revert ZeroAddress();
        outcomeOf[intentId] = Outcome.RECIPIENT_FALLBACK;
        asset.safeTransfer(fallbackRecipient, amount);
        emit RecipientPaidByFallback(intentId, fallbackRecipient, amount);
        return Outcome.RECIPIENT_FALLBACK;
    }
}
