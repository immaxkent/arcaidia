// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Intent, INTENT_VERSION, USDC_TOKEN_OUT} from "./libraries/ArcaidiaTypes.sol";
import {IntentLib} from "./libraries/IntentLib.sol";
import {IntentHookLib} from "./libraries/IntentHookLib.sol";
import {ISettlementInitiator} from "./interfaces/ISettlementInitiator.sol";

/// @title ArcaidiaIntentRouter
/// @notice Source-side entry point: pulls the user's settlement asset, commits
///         it to canonical settlement, and records an immutable intent.
///
/// @dev The central guarantee of this contract is that **an intent cannot exist
///      without its canonical commitment**. `createIntent` pulls funds and
///      initiates settlement in one transaction and emits `IntentCreated` only
///      after both succeed; if commitment fails, everything reverts. A solver
///      that sees the event therefore knows the source funds are already
///      committed, which is what makes advancing LP capital reasonable rather
///      than reckless.
///
///      There is deliberately no cancel-and-withdraw path after commitment.
///
///      This is one contract deployed to both chains. It names no chain: the
///      source is `block.chainid` and the destination is a parameter, so the
///      same bytecode is the Ethereum router and the Arc router.
///
///      **v2 (WP-25).** Intents carry the v1.1 schema (`tokenOut`/`targetMinOut`,
///      DECISIONS.md D5) and the router hands the settlement transport an intent
///      hook — `IntentHookLib.encode(intentId, recipient)` — that CCTP carries
///      under its own attestation to the destination (D8). Trade intents are
///      accepted on chain from day one: if no solver can satisfy the swap, canonical
///      settlement delivers USDC to `recipient` exactly as for a plain transfer, so
///      accepting them never strands funds. `tradeIntentsAllowed` is an emergency
///      brake only.
///
///      Constructor takes no arguments so that init code — and therefore the
///      CREATE2 address — is identical on every chain. All chain-specific
///      values arrive through `initialize`, which is why deployment must
///      deploy and initialize atomically (see the WP-01 deployment script).
contract ArcaidiaIntentRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using IntentLib for Intent;

    // -----------------------------------------------------------------------
    // Configuration
    // -----------------------------------------------------------------------

    address public owner;

    /// @notice Named by `transferOwnership`, effective only once it calls `acceptOwnership`.
    /// @dev Two steps because one is unforgiving: every privileged call on this contract is
    ///      `onlyOwner`, and a mistyped address in a single-step handover removes the pause,
    ///      the limits and the wiring from anyone's reach, permanently (MN-07 / C-20).
    address public pendingOwner;
    bool public initialized;
    bool public paused;

    /// @notice The one asset this router accepts. Selecting MockUSDC or real
    ///         USDC is this address and nothing else — there is no runtime switch.
    IERC20 public settlementAsset;

    /// @notice Canonical settlement transport. Mock in tests, CCTP in WP-10.
    ISettlementInitiator public settlementInitiator;

    /// @notice Destination chain allowlist and receiver in one mapping: a zero
    ///         address means the destination is not permitted.
    /// @dev Because Arcaidia deploys through CREATE2, the `SettlementReceiver`
    ///      is expected to share one address across chains — but this is stored
    ///      per chain rather than assumed, so address parity is a convenience
    ///      and never a correctness dependency.
    mapping(uint256 => address) public destinationReceiver;

    /// @notice Largest single intent.
    uint256 public maxIntentAmount;

    /// @notice Largest total value this router will commit within any 24-hour window.
    /// @dev MN-06. This replaced an aggregate "in flight" figure that only ever grew: nothing on
    ///      this chain can observe settlement, which completes on the *other* one, so releasing
    ///      capacity was an owner transaction nobody automated. On testnet the counter reached
    ///      12,764 USDC of a 200,000 cap and would eventually have stopped the router outright.
    ///      A window that resets itself bounds the same risk — how much can be committed before
    ///      anyone reacts — without depending on a key being online.
    uint256 public maxVolumePerWindow;

    /// @notice When the current window began.
    uint64 public windowStartedAt;

    /// @notice Value committed since `windowStartedAt`.
    uint256 public windowVolume;

    uint64 public constant VOLUME_WINDOW = 1 days;

    /// @notice Emergency brake for trade intents (`tokenOut != USDC_TOKEN_OUT`). True by default.
    bool public tradeIntentsAllowed;

    // -----------------------------------------------------------------------
    // Intent state
    // -----------------------------------------------------------------------

    mapping(bytes32 => bool) public intentExists;
    mapping(address => mapping(uint256 => bool)) public nonceUsed;

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    /// @dev Carries everything the subgraph and the agent need, including the
    ///      settlement reference used to correlate canonical funds. Under-
    ///      specifying this event costs a redeploy once the subgraph exists.
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
    event TradeIntentsAllowedSet(bool allowed);

    event RouterInitialized(address owner, address settlementAsset, address settlementInitiator);
    event DestinationConfigured(uint256 indexed chainId, address receiver);
    event LimitsConfigured(uint256 maxIntentAmount, uint256 maxVolumePerWindow);
    event PausedSet(bool paused);
    event OwnerTransferred(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);

    // -----------------------------------------------------------------------
    // Errors
    // -----------------------------------------------------------------------

    error AlreadyInitialized();
    error NotOwner();
    error NotPendingOwner(address caller);
    error RouterPaused();
    error ZeroAddress();
    error ZeroAmount();
    error DestinationNotAllowed(uint256 chainId);
    error DestinationIsSourceChain();
    error SettlementTransportUnavailable(uint256 chainId);
    error IntentAmountAboveCap(uint256 amount, uint256 cap);
    error VolumeCapExceeded(uint256 attempted, uint256 cap);
    error DeadlineInPast(uint64 deadline);
    error NonceAlreadyUsed(address sender, uint256 nonce);
    error IntentAlreadyExists(bytes32 intentId);
    error FeeCeilingAboveDenominator(uint16 maxFeeBps);
    /// `tokenOut == USDC_TOKEN_OUT` requires `targetMinOut == 0`; any other `tokenOut` requires `targetMinOut > 0`.
    error InvalidTradeTerms(address tokenOut, uint256 targetMinOut);
    error TradeIntentsDisabled();

    uint16 internal constant BPS_DENOMINATOR = 10_000;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // -----------------------------------------------------------------------
    // Initialization
    // -----------------------------------------------------------------------

    /// @notice One-time configuration, applied after deterministic deployment.
    /// @dev Callable by anyone exactly once, because a CREATE2 factory deploy
    ///      leaves no trustworthy record of the intended deployer. Deployment
    ///      MUST therefore deploy and initialize in a single transaction; the
    ///      deployment script asserts the resulting configuration.
    function initialize(
        address owner_,
        address settlementAsset_,
        address settlementInitiator_,
        uint256 maxIntentAmount_,
        uint256 maxVolumePerWindow_
    ) external {
        if (initialized) revert AlreadyInitialized();
        if (owner_ == address(0) || settlementAsset_ == address(0) || settlementInitiator_ == address(0)) {
            revert ZeroAddress();
        }

        initialized = true;
        owner = owner_;
        tradeIntentsAllowed = true;
        settlementAsset = IERC20(settlementAsset_);
        settlementInitiator = ISettlementInitiator(settlementInitiator_);
        maxIntentAmount = maxIntentAmount_;
        maxVolumePerWindow = maxVolumePerWindow_;
        windowStartedAt = uint64(block.timestamp);

        emit RouterInitialized(owner_, settlementAsset_, settlementInitiator_);
        emit LimitsConfigured(maxIntentAmount_, maxVolumePerWindow_);
    }

    // -----------------------------------------------------------------------
    // Owner configuration
    // -----------------------------------------------------------------------

    function setDestination(uint256 chainId, address receiver) external onlyOwner {
        if (chainId == block.chainid) revert DestinationIsSourceChain();
        destinationReceiver[chainId] = receiver;
        emit DestinationConfigured(chainId, receiver);
    }

    function setLimits(uint256 maxIntentAmount_, uint256 maxVolumePerWindow_) external onlyOwner {
        maxIntentAmount = maxIntentAmount_;
        maxVolumePerWindow = maxVolumePerWindow_;
        emit LimitsConfigured(maxIntentAmount_, maxVolumePerWindow_);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    function setTradeIntentsAllowed(bool allowed) external onlyOwner {
        tradeIntentsAllowed = allowed;
        emit TradeIntentsAllowedSet(allowed);
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

    // -----------------------------------------------------------------------
    // Intent creation
    // -----------------------------------------------------------------------

    /// @notice Commit funds and create an intent.
    /// @param tokenOut `USDC_TOKEN_OUT` (zero) for a plain USDC transfer; otherwise the asset the
    ///        recipient wants on the destination chain (a trade intent).
    /// @param targetMinOut Minimum acceptable `tokenOut` delivered; must be 0 for a plain transfer
    ///        and non-zero for a trade intent.
    /// @return intentId The canonical identifier, identical to the one the
    ///         shared TypeScript domain package computes off-chain.
    function createIntent(
        address recipient,
        uint256 amount,
        uint256 destinationChainId,
        uint16 maxFeeBps,
        uint64 deadline,
        uint256 nonce,
        address tokenOut,
        uint256 targetMinOut
    ) external nonReentrant returns (bytes32 intentId) {
        if (paused) revert RouterPaused();
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (maxFeeBps > BPS_DENOMINATOR) revert FeeCeilingAboveDenominator(maxFeeBps);
        if (amount > maxIntentAmount) revert IntentAmountAboveCap(amount, maxIntentAmount);
        if (deadline <= block.timestamp) revert DeadlineInPast(deadline);
        if (nonceUsed[msg.sender][nonce]) revert NonceAlreadyUsed(msg.sender, nonce);
        _validateTradeTerms(tokenOut, targetMinOut);

        address receiver = destinationReceiver[destinationChainId];
        if (receiver == address(0)) revert DestinationNotAllowed(destinationChainId);

        // Checked before any funds move, so a user is never left with funds
        // taken and no canonical commitment.
        if (!settlementInitiator.supportsDestination(destinationChainId)) {
            revert SettlementTransportUnavailable(destinationChainId);
        }

        uint256 committed = volumeInWindow();
        uint256 newVolume = committed + amount;
        if (newVolume > maxVolumePerWindow) revert VolumeCapExceeded(newVolume, maxVolumePerWindow);

        Intent memory intent = Intent({
            intentVersion: INTENT_VERSION,
            sender: msg.sender,
            recipient: recipient,
            inputToken: address(settlementAsset),
            amount: amount,
            sourceChainId: block.chainid,
            destinationChainId: destinationChainId,
            maxFeeBps: maxFeeBps,
            deadline: deadline,
            nonce: nonce,
            tokenOut: tokenOut,
            targetMinOut: targetMinOut
        });

        intentId = intent.computeIntentId();
        if (intentExists[intentId]) revert IntentAlreadyExists(intentId);

        // Effects before interactions.
        intentExists[intentId] = true;
        nonceUsed[msg.sender][nonce] = true;
        if (committed == 0 && windowVolume != 0) windowStartedAt = uint64(block.timestamp);
        windowVolume = newVolume;

        bytes32 settlementRef = _commit(intent, intentId, receiver);
        _emitCreated(intent, intentId, settlementRef);
    }

    /// @dev Pull the principal and commit it to canonical settlement, carrying the intent hook.
    ///      If the transport reverts, the whole transaction reverts: no intent, no event, and
    ///      the user keeps their funds. Split out of `createIntent` to keep that frame within
    ///      stack depth under `via_ir = false`.
    function _commit(Intent memory intent, bytes32 intentId, address receiver)
        private
        returns (bytes32 settlementRef)
    {
        settlementAsset.safeTransferFrom(msg.sender, address(this), intent.amount);
        settlementAsset.forceApprove(address(settlementInitiator), intent.amount);

        settlementRef = settlementInitiator.initiateSettlement(
            address(settlementAsset),
            intent.amount,
            intent.destinationChainId,
            receiver,
            intentId,
            IntentHookLib.encode(intentId, intent.recipient)
        );

        // Leave no standing allowance if the initiator pulled less than approved.
        settlementAsset.forceApprove(address(settlementInitiator), 0);
    }

    /// @dev Its own frame for the same stack-depth reason as `_commit`. Flat parameters — the
    ///      shape `IArcaidiaEventsV2.IntentCreated` freezes — rather than a tuple, so the
    ///      indexer's ABI-driven views stay column-per-field.
    function _emitCreated(Intent memory intent, bytes32 intentId, bytes32 settlementRef) private {
        emit IntentCreated(
            intentId,
            intent.sender,
            intent.recipient,
            intent.intentVersion,
            intent.inputToken,
            intent.amount,
            intent.sourceChainId,
            intent.destinationChainId,
            intent.maxFeeBps,
            intent.deadline,
            intent.nonce,
            intent.tokenOut,
            intent.targetMinOut,
            settlementRef
        );
    }

    /// @dev A plain transfer is `(USDC_TOKEN_OUT, 0)`; a trade intent is any other `tokenOut`
    ///      with a non-zero floor. Anything else is a malformed request, refused before funds move.
    function _validateTradeTerms(address tokenOut, uint256 targetMinOut) private view {
        if (tokenOut == USDC_TOKEN_OUT) {
            if (targetMinOut != 0) revert InvalidTradeTerms(tokenOut, targetMinOut);
            return;
        }
        if (targetMinOut == 0) revert InvalidTradeTerms(tokenOut, targetMinOut);
        if (!tradeIntentsAllowed) revert TradeIntentsDisabled();
    }

    /// @notice Value committed in the current window, or zero once the window has rolled over.
    function volumeInWindow() public view returns (uint256) {
        return block.timestamp >= uint256(windowStartedAt) + VOLUME_WINDOW ? 0 : windowVolume;
    }

    /// @notice Recompute an intent id off a set of terms, for clients and tests.
    function quoteIntentId(
        address sender,
        address recipient,
        uint256 amount,
        uint256 destinationChainId,
        uint16 maxFeeBps,
        uint64 deadline,
        uint256 nonce,
        address tokenOut,
        uint256 targetMinOut
    ) external view returns (bytes32) {
        return IntentLib.computeIntentId(
            Intent({
                intentVersion: INTENT_VERSION,
                sender: sender,
                recipient: recipient,
                inputToken: address(settlementAsset),
                amount: amount,
                sourceChainId: block.chainid,
                destinationChainId: destinationChainId,
                maxFeeBps: maxFeeBps,
                deadline: deadline,
                nonce: nonce,
                tokenOut: tokenOut,
                targetMinOut: targetMinOut
            })
        );
    }
}
