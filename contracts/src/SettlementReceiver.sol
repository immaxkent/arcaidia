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
///      asserted amount and recipient of V1 are gone entirely: MN-04 removed the reporter-gated
///      `settle` valve, which could mark any intent settled off one unit of donated balance and
///      send parked funds anywhere. Settlement now has exactly one door, and Circle's attestation
///      plus the trusted initiator decide what comes through it.
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
        HELD_FOR_VAULT,
        /// Paying the attested recipient failed — a blocklisted address, say. The funds are parked
        /// for that recipient and nobody else; `retryHeld` pays them once the block is lifted.
        HELD_FOR_RECIPIENT
    }

    address public owner;

    /// @notice Named by `transferOwnership`, effective only once it calls `acceptOwnership`.
    /// @dev One mistyped address in a single-step handover would leave nobody able to trust a
    ///      source domain again — the only privileged call this contract has (MN-07 / C-20).
    address public pendingOwner;

    bool public initialized;

    IERC20 public asset;
    IIntentMarket public market;
    IMessageTransmitterV2 public messageTransmitter;

    /// @notice The `CircleCCTPInitiator` on each source CCTP domain whose burns this receiver
    ///         accepts. Set once per domain by the owner, never changed.
    /// @dev Circle attests *any* valid burn, and `hookData` is caller-chosen, so without this a
    ///      stranger could burn one unit naming someone else's `intentId` and have this contract
    ///      record that intent as settled — locking the genuine message out forever, because the
    ///      router names this contract as the message's `destinationCaller`.
    mapping(uint32 => address) public trustedInitiator;

    /// @notice Settlement outcome per intent. `NONE` means not yet settled.
    mapping(bytes32 => Outcome) public outcomeOf;

    /// @notice Canonical amount recorded per intent.
    mapping(bytes32 => uint256) public settledAmount;

    /// @notice Who is owed parked funds, per intent in a `HELD_*` outcome: the winning vault, or
    ///         the recipient the attestation named.
    mapping(bytes32 => address) public heldFor;

    event ReceiverInitialized(address owner, address asset, address market, address messageTransmitter);
    event TrustedInitiatorSet(uint32 indexed sourceDomain, address initiator);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnerTransferred(address indexed previousOwner, address indexed newOwner);
    event LpReimbursed(bytes32 indexed intentId, address indexed vault, uint256 amount);
    event RecipientPaidByFallback(bytes32 indexed intentId, address indexed recipient, uint256 amount);
    event SettledWithProof(bytes32 indexed intentId, uint8 outcome, uint256 amount, bytes32 cctpNonce);
    event HeldForVault(bytes32 indexed intentId, address indexed vault, uint256 amount);
    event HeldForRecipient(bytes32 indexed intentId, address indexed recipient, uint256 amount);

    error AlreadyInitialized();
    /// The market named here settles through a different receiver (MN-02).
    error MarketSettlesElsewhere(address marketReceiver);
    error NotOwner();
    error NotPendingOwner(address caller);
    error ZeroAddress();
    error ZeroAmount();
    error AlreadySettled(bytes32 intentId);
    error MessageNotForThisReceiver(address destinationCaller, address mintRecipient);
    error UntrustedSource(uint32 sourceDomain, address messageSender);
    error TrustedInitiatorAlreadySet(uint32 sourceDomain, address initiator);
    error MessageNotAccepted();
    error MintedAmountMismatch(uint256 expected, uint256 actual);
    error NothingHeld(bytes32 intentId);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function initialize(address owner_, address asset_, address market_, address messageTransmitter_) external {
        if (initialized) revert AlreadyInitialized();
        if (
            owner_ == address(0) || asset_ == address(0) || market_ == address(0)
                || messageTransmitter_ == address(0)
        ) revert ZeroAddress();

        // D12 is the reason this exists. The v2.0 receiver was replaced on its own and the new
        // one was initialised against the *existing* market — whose immutable settlement check
        // still named the retired contract. Every vault then asked a receiver that would never
        // settle anything, and one intent on Arc testnet was paid twice. A receiver, its market
        // and its factory are one unit: if the market does not settle through this contract,
        // this contract has no business existing beside it.
        address marketReceiver = IIntentMarket(market_).settlementCheck();
        if (marketReceiver != address(this)) revert MarketSettlesElsewhere(marketReceiver);

        initialized = true;
        owner = owner_;
        asset = IERC20(asset_);
        market = IIntentMarket(market_);
        messageTransmitter = IMessageTransmitterV2(messageTransmitter_);

        emit ReceiverInitialized(owner_, asset_, market_, messageTransmitter_);
    }

    /// @notice Trust the initiator that burns on `sourceDomain`. One address per domain, forever.
    function setTrustedInitiator(uint32 sourceDomain, address initiator) external onlyOwner {
        if (initiator == address(0)) revert ZeroAddress();
        address existing = trustedInitiator[sourceDomain];
        if (existing != address(0)) revert TrustedInitiatorAlreadySet(sourceDomain, existing);
        trustedInitiator[sourceDomain] = initiator;
        emit TrustedInitiatorSet(sourceDomain, initiator);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    /// @notice Take ownership named by the current owner. Only the named address can.
    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner(msg.sender);
        address previous = owner;
        owner = msg.sender;
        delete pendingOwner;
        emit OwnerTransferred(previous, msg.sender);
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
        // In a CCTP V2 burn message the header's `recipient` is Circle's own TokenMessenger on this
        // chain (the handler `receiveMessage` dispatches to), never us. What names *this* contract
        // is the burn body's `mintRecipient` (where the USDC lands) and, when the source set one,
        // the header's `destinationCaller` (who may present the message). Both are checked; the
        // balance delta below is the proof the mint actually happened here.
        if (
            parsed.mintRecipient != address(this)
                || (parsed.destinationCaller != address(0) && parsed.destinationCaller != address(this))
        ) {
            revert MessageNotForThisReceiver(parsed.destinationCaller, parsed.mintRecipient);
        }
        // Who burned decides whether this message means anything here. Only the protocol's own
        // initiator on a trusted domain can name an `intentId`, and only its router can call it.
        address trusted = trustedInitiator[parsed.sourceDomain];
        if (trusted == address(0) || parsed.messageSender != trusted) {
            revert UntrustedSource(parsed.sourceDomain, parsed.messageSender);
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

    /// @notice Retry a payment that could not be made when the message arrived. Anyone may call,
    ///         and the money can only go where it was already owed.
    /// @dev Two parked states, one door: a winner whose `recordReimbursement` reverted, and a
    ///      recipient the asset refused to pay (MN-05). Neither can be redirected — `heldFor` was
    ///      written from the market's record or from Circle's attested hook, and nothing here
    ///      takes an address from the caller.
    function retryHeld(bytes32 intentId) external nonReentrant {
        Outcome held = outcomeOf[intentId];
        address owed = heldFor[intentId];
        uint256 amount = settledAmount[intentId];

        if (held == Outcome.HELD_FOR_VAULT) {
            outcomeOf[intentId] = Outcome.LP_REIMBURSED;
            delete heldFor[intentId];

            asset.forceApprove(owed, amount);
            IFillRegistry(owed).recordReimbursement(intentId, amount);
            asset.forceApprove(owed, 0);
            emit LpReimbursed(intentId, owed, amount);
            return;
        }

        if (held == Outcome.HELD_FOR_RECIPIENT) {
            outcomeOf[intentId] = Outcome.RECIPIENT_FALLBACK;
            delete heldFor[intentId];

            asset.safeTransfer(owed, amount);
            emit RecipientPaidByFallback(intentId, owed, amount);
            return;
        }

        revert NothingHeld(intentId);
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

        // MN-05: USDC enforces its blocklist at transfer time, on Arc and on Ethereum alike. A
        // recipient blocked between the burn and the mint would otherwise revert this whole call
        // — and because the router names this contract as the message's `destinationCaller`,
        // nobody else could ever present that message. Park the funds for that recipient instead;
        // `retryHeld` pays them the day the block lifts, and can pay nobody else.
        outcomeOf[intentId] = Outcome.RECIPIENT_FALLBACK;
        (bool ok, bytes memory returned) =
            address(asset).call(abi.encodeCall(IERC20.transfer, (fallbackRecipient, amount)));
        if (ok && (returned.length == 0 || abi.decode(returned, (bool)))) {
            emit RecipientPaidByFallback(intentId, fallbackRecipient, amount);
            return Outcome.RECIPIENT_FALLBACK;
        }

        outcomeOf[intentId] = Outcome.HELD_FOR_RECIPIENT;
        heldFor[intentId] = fallbackRecipient;
        emit HeldForRecipient(intentId, fallbackRecipient, amount);
        return Outcome.HELD_FOR_RECIPIENT;
    }
}
