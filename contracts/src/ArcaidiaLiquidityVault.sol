// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IFillRegistry} from "./interfaces/IFillRegistry.sol";
import {FillAuthorization} from "./libraries/ArcaidiaTypes.sol";
import {FillAuthorizationLib} from "./libraries/FillAuthorizationLib.sol";

/// @title ArcaidiaLiquidityVault
/// @notice Destination-side LP inventory: an ERC-4626 tokenized vault whose
///         assets may be advanced to recipients ahead of canonical settlement.
///
/// @dev **Why this does not inherit OpenZeppelin's ERC4626.** That
///      implementation takes the asset as a constructor argument and stores it
///      as an immutable. Constructor arguments are part of init code, and init
///      code determines the CREATE2 address — so an immutable asset would give
///      this contract a different address on Ethereum than on Arc, because the
///      two chains have different USDC addresses. Arcaidia treats identical
///      addresses as an acceptance criterion, so the asset lives in storage and
///      is set by `initialize`. The ERC-20 share token's name and symbol are
///      constructor arguments, but they are the same strings on every chain, so
///      init code stays identical.
///
///      **`totalAssets` counts the receivable.** A fast fill sends assets out of
///      the vault before canonical settlement reimburses it. If `totalAssets`
///      counted only the liquid balance, an LP could redeem while a fill was in
///      flight, exit at an artificially low share price, and leave the remaining
///      LPs carrying the exposure. So `totalAssets = liquidBalance +
///      outstandingExposure`.
///
///      **Withdrawals are still bounded by liquid balance.** A receivable is an
///      asset but not a payable one. `maxWithdraw` is capped by what the vault
///      actually holds; an LP can be owed more than it can currently redeem.
///
///      Rounding always favours the vault over the caller, so no sequence of
///      deposits and redemptions can extract value from other LPs.
contract ArcaidiaLiquidityVault is ERC20, ReentrancyGuard, IFillRegistry {
    using SafeERC20 for IERC20;
    using Math for uint256;

    // -----------------------------------------------------------------------
    // Configuration
    // -----------------------------------------------------------------------

    address public owner;
    bool public initialized;
    bool public paused;

    /// @notice The settlement asset. Storage, not immutable — see the note above.
    IERC20 public asset;

    uint8 private _assetDecimals;

    /// @notice Share of total assets that may never be advanced, in basis points.
    uint16 public reserveFloorBps;

    /// @notice Largest single fill, regardless of available liquidity.
    uint256 public maxFillAmount;

    /// @notice Largest aggregate advanced-and-unreimbursed principal.
    uint256 public maxOutstandingExposure;

    /// @notice Protocol fee ceiling. The user's own ceiling may be lower and is
    ///         enforced by the agent before it ever signs.
    uint16 public maxFeeBps;

    /// @notice Agent authorities whose signatures this vault accepts.
    /// @dev An allowlist of recovered EIP-712 signers, not of callers: any
    ///      relayer may submit a validly signed authorization.
    mapping(address => bool) public isAuthorisedSigner;

    /// @notice Agent-side replay protection, independent of `intentId`.
    mapping(uint256 => bool) public agentNonceUsed;

    /// @notice Principal advanced to recipients and awaiting canonical reimbursement.
    uint256 public outstandingExposure;

    /// @notice The destination `SettlementReceiver` permitted to reimburse.
    address public settlementReceiver;

    /// @notice Where protocol fees are swept.
    address public treasury;

    /// @notice The protocol's share of each execution fee, in basis points.
    /// @dev The remainder accrues to LPs as share-price appreciation.
    uint16 public protocolFeeShareBps;

    /// @notice Protocol fees held by the vault and owed to the treasury.
    /// @dev Held here for convenience, but **not LP capital**. Excluded from
    ///      `totalAssets`, from deployable liquidity and from what an LP may
    ///      withdraw — otherwise LPs would be credited with, and could redeem
    ///      against, money that belongs to the treasury.
    uint256 public accruedProtocolFees;

    /// @notice Intents whose recipient has been paid from LP inventory.
    /// @dev Also the replay key: an intent may be filled at most once.
    mapping(bytes32 => bool) public intentFilled;

    /// @notice Principal advanced per intent, cleared on reimbursement.
    /// @dev This is the *output* amount — what actually left the vault — not the
    ///      input amount that canonical settlement will return. Recording the
    ///      smaller figure keeps `totalAssets` flat at fill time and recognises
    ///      the fee only when it is realised, rather than marking LPs up on a
    ///      settlement that has not happened yet.
    mapping(bytes32 => uint256) public advancedPrincipal;

    uint16 internal constant BPS_DENOMINATOR = 10_000;

    /// @dev Virtual shares/assets offset, the standard ERC-4626 inflation-attack
    ///      mitigation: it makes the first depositor unable to move the share
    ///      price far enough to steal a later deposit through a direct transfer.
    uint8 internal constant DECIMALS_OFFSET = 6;

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    event VaultInitialized(address owner, address asset, uint16 reserveFloorBps);
    event Deposit(address indexed caller, address indexed receiver, uint256 assets, uint256 shares);
    event Withdraw(
        address indexed caller,
        address indexed receiver,
        address indexed shareOwner,
        uint256 assets,
        uint256 shares
    );
    event ReserveFloorConfigured(uint16 reserveFloorBps);
    event SettlementReceiverConfigured(address settlementReceiver);
    event FillRecorded(bytes32 indexed intentId, address indexed recipient, uint256 outputAmount);
    event ReimbursementRecorded(bytes32 indexed intentId, uint256 amountReceived, uint256 exposureCleared);
    event FillLimitsConfigured(uint256 maxFillAmount, uint256 maxOutstandingExposure, uint16 maxFeeBps);
    event TreasuryConfigured(address treasury);
    event ProtocolFeeShareConfigured(uint16 protocolFeeShareBps);
    event FeesAccrued(bytes32 indexed intentId, uint256 toProtocol, uint256 toLps);
    event FeesWithdrawn(address indexed treasury, uint256 amount);
    event AuthorisedSignerSet(address indexed signer, bool allowed);
    event FastFilled(
        bytes32 indexed intentId,
        address indexed recipient,
        address indexed signer,
        uint256 inputAmount,
        uint256 outputAmount,
        uint256 feeAmount
    );
    event PausedSet(bool paused);
    event OwnerTransferred(address indexed previousOwner, address indexed newOwner);

    // -----------------------------------------------------------------------
    // Errors
    // -----------------------------------------------------------------------

    error AlreadyInitialized();
    error NotOwner();
    error VaultPaused();
    error ZeroAddress();
    error ZeroAmount();
    error ReserveFloorTooHigh(uint16 bps);
    error ExceedsMaxDeposit(uint256 assets, uint256 max);
    error ExceedsMaxWithdraw(uint256 assets, uint256 max);
    error ExceedsMaxRedeem(uint256 shares, uint256 max);
    error InsufficientLiquidity(uint256 requested, uint256 available);
    error NotSettlementReceiver();
    error IntentAlreadyFilled(bytes32 intentId);
    error IntentNotFilled(bytes32 intentId);
    error ReimbursementBelowPrincipal(uint256 received, uint256 principal);
    error AuthorizationExpired(uint64 expiry, uint256 nowTimestamp);
    error SignerNotAuthorised(address signer);
    error AgentNonceAlreadyUsed(uint256 nonce);
    error AmountsInconsistent(uint256 inputAmount, uint256 outputAmount, uint256 feeAmount);
    error FeeAboveProtocolCeiling(uint256 feeAmount, uint256 ceiling);
    error FillAboveCap(uint256 outputAmount, uint256 cap);
    error ExposureCapExceeded(uint256 attempted, uint256 cap);
    error WrongDestinationChain(uint256 sourceChainId);
    error TreasuryNotSet();
    error NoFeesAccrued();
    error ShareAboveDenominator(uint16 bps);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @dev Name and symbol are identical on every chain, so these constructor
    ///      arguments do not disturb CREATE2 address parity.
    constructor() ERC20("Arcaidia Liquidity", "arcLP") {}

    function initialize(address owner_, address asset_, uint16 reserveFloorBps_) external {
        if (initialized) revert AlreadyInitialized();
        if (owner_ == address(0) || asset_ == address(0)) revert ZeroAddress();
        if (reserveFloorBps_ > BPS_DENOMINATOR) revert ReserveFloorTooHigh(reserveFloorBps_);

        initialized = true;
        owner = owner_;
        asset = IERC20(asset_);
        _assetDecimals = IERC20Metadata(asset_).decimals();
        reserveFloorBps = reserveFloorBps_;

        emit VaultInitialized(owner_, asset_, reserveFloorBps_);
    }

    // -----------------------------------------------------------------------
    // Owner configuration
    // -----------------------------------------------------------------------

    function setReserveFloorBps(uint16 bps) external onlyOwner {
        if (bps > BPS_DENOMINATOR) revert ReserveFloorTooHigh(bps);
        reserveFloorBps = bps;
        emit ReserveFloorConfigured(bps);
    }

    function setSettlementReceiver(address receiver) external onlyOwner {
        if (receiver == address(0)) revert ZeroAddress();
        settlementReceiver = receiver;
        emit SettlementReceiverConfigured(receiver);
    }

    function setFillLimits(uint256 maxFillAmount_, uint256 maxOutstandingExposure_, uint16 maxFeeBps_)
        external
        onlyOwner
    {
        if (maxFeeBps_ > BPS_DENOMINATOR) revert ReserveFloorTooHigh(maxFeeBps_);
        maxFillAmount = maxFillAmount_;
        maxOutstandingExposure = maxOutstandingExposure_;
        maxFeeBps = maxFeeBps_;
        emit FillLimitsConfigured(maxFillAmount_, maxOutstandingExposure_, maxFeeBps_);
    }

    function setAuthorisedSigner(address signer, bool allowed) external onlyOwner {
        if (signer == address(0)) revert ZeroAddress();
        isAuthorisedSigner[signer] = allowed;
        emit AuthorisedSignerSet(signer, allowed);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasuryConfigured(treasury_);
    }

    function setProtocolFeeShareBps(uint16 bps) external onlyOwner {
        if (bps > BPS_DENOMINATOR) revert ShareAboveDenominator(bps);
        protocolFeeShareBps = bps;
        emit ProtocolFeeShareConfigured(bps);
    }

    /// @notice Sweep accrued protocol fees to the treasury.
    /// @dev Can only ever move fees. LP principal and the outstanding receivable
    ///      are unreachable from here, so the owner key cannot drain the vault.
    function withdrawFees() external onlyOwner nonReentrant returns (uint256 amount) {
        if (treasury == address(0)) revert TreasuryNotSet();

        amount = accruedProtocolFees;
        if (amount == 0) revert NoFeesAccrued();

        accruedProtocolFees = 0;
        asset.safeTransfer(treasury, amount);
        emit FeesWithdrawn(treasury, amount);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnerTransferred(owner, newOwner);
        owner = newOwner;
    }

    // -----------------------------------------------------------------------
    // Accounting
    // -----------------------------------------------------------------------

    function decimals() public view override returns (uint8) {
        return _assetDecimals + DECIMALS_OFFSET;
    }

    /// @notice Every unit of the settlement asset sitting in this contract.
    /// @dev Includes protocol fees, which are held here but owed to the treasury.
    ///      Use `lpLiquidBalance` for anything that answers a question about LPs.
    function liquidBalance() public view returns (uint256) {
        return asset.balanceOf(address(this));
    }

    /// @notice Held balance that actually belongs to LPs.
    function lpLiquidBalance() public view returns (uint256) {
        uint256 held = liquidBalance();
        return held > accruedProtocolFees ? held - accruedProtocolFees : 0;
    }

    /// @notice LP-owned assets: their liquid balance plus the receivable.
    /// @dev The receivable must be counted or an LP could redeem mid-fill at an
    ///      unfairly low price. Protocol fees must be excluded or LPs would be
    ///      credited with money that belongs to the treasury.
    function totalAssets() public view returns (uint256) {
        return lpLiquidBalance() + outstandingExposure;
    }

    /// @notice Capital that must remain unadvanced.
    function reserveFloor() public view returns (uint256) {
        return totalAssets().mulDiv(reserveFloorBps, BPS_DENOMINATOR, Math.Rounding.Ceil);
    }

    /// @notice Capital deployable for a fast fill right now.
    /// @dev Bounded by the *liquid* balance, not by `totalAssets`: a receivable
    ///      cannot be advanced a second time.
    function availableLiquidity() public view returns (uint256) {
        uint256 liquid = lpLiquidBalance();
        uint256 floor = reserveFloor();
        return liquid > floor ? liquid - floor : 0;
    }

    /// @notice Advanced principal as a share of total capital, in basis points.
    function utilisationBps() public view returns (uint256) {
        uint256 total = totalAssets();
        if (total == 0) return BPS_DENOMINATOR;
        return outstandingExposure.mulDiv(BPS_DENOMINATOR, total);
    }

    // -----------------------------------------------------------------------
    // ERC-4626 conversions
    // -----------------------------------------------------------------------

    function convertToShares(uint256 assets) public view returns (uint256) {
        return _convertToShares(assets, Math.Rounding.Floor);
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        return _convertToAssets(shares, Math.Rounding.Floor);
    }

    function _convertToShares(uint256 assets, Math.Rounding rounding) internal view returns (uint256) {
        return assets.mulDiv(totalSupply() + 10 ** DECIMALS_OFFSET, totalAssets() + 1, rounding);
    }

    function _convertToAssets(uint256 shares, Math.Rounding rounding) internal view returns (uint256) {
        return shares.mulDiv(totalAssets() + 1, totalSupply() + 10 ** DECIMALS_OFFSET, rounding);
    }

    /// @dev Rounding direction is deliberate throughout: shares minted round
    ///      down, shares burned round up, so the caller never gains at the
    ///      expense of existing LPs.
    function previewDeposit(uint256 assets) public view returns (uint256) {
        return _convertToShares(assets, Math.Rounding.Floor);
    }

    function previewMint(uint256 shares) public view returns (uint256) {
        return _convertToAssets(shares, Math.Rounding.Ceil);
    }

    function previewWithdraw(uint256 assets) public view returns (uint256) {
        return _convertToShares(assets, Math.Rounding.Ceil);
    }

    function previewRedeem(uint256 shares) public view returns (uint256) {
        return _convertToAssets(shares, Math.Rounding.Floor);
    }

    function maxDeposit(address) public view returns (uint256) {
        return paused ? 0 : type(uint256).max;
    }

    function maxMint(address) public view returns (uint256) {
        return paused ? 0 : type(uint256).max;
    }

    /// @notice What an owner can withdraw now: what they are owed, capped by
    ///         what the vault actually holds.
    function maxWithdraw(address shareOwner) public view returns (uint256) {
        uint256 owed = _convertToAssets(balanceOf(shareOwner), Math.Rounding.Floor);
        uint256 liquid = lpLiquidBalance();
        return owed < liquid ? owed : liquid;
    }

    /// @notice Shares an owner can redeem now.
    /// @dev Only converts when liquidity is actually the binding constraint.
    ///      Converting unconditionally would round shares to assets and back,
    ///      flooring twice, and leave an owner whose entire position is covered
    ///      by the liquid balance unable to redeem the last dust of it.
    function maxRedeem(address shareOwner) public view returns (uint256) {
        uint256 shares = balanceOf(shareOwner);
        uint256 owed = _convertToAssets(shares, Math.Rounding.Floor);
        uint256 liquid = lpLiquidBalance();

        if (owed <= liquid) return shares;
        return _convertToShares(liquid, Math.Rounding.Floor);
    }

    // -----------------------------------------------------------------------
    // ERC-4626 entry points
    // -----------------------------------------------------------------------

    function deposit(uint256 assets, address receiver) external nonReentrant returns (uint256 shares) {
        if (paused) revert VaultPaused();
        if (assets == 0) revert ZeroAmount();
        if (receiver == address(0)) revert ZeroAddress();

        shares = previewDeposit(assets);
        if (shares == 0) revert ZeroAmount();
        _pullAndMint(assets, shares, receiver);
    }

    function mint(uint256 shares, address receiver) external nonReentrant returns (uint256 assets) {
        if (paused) revert VaultPaused();
        if (shares == 0) revert ZeroAmount();
        if (receiver == address(0)) revert ZeroAddress();

        assets = previewMint(shares);
        _pullAndMint(assets, shares, receiver);
    }

    function withdraw(uint256 assets, address receiver, address shareOwner)
        external
        nonReentrant
        returns (uint256 shares)
    {
        if (assets == 0) revert ZeroAmount();
        uint256 max = maxWithdraw(shareOwner);
        if (assets > max) revert ExceedsMaxWithdraw(assets, max);

        shares = previewWithdraw(assets);
        _burnAndPay(shares, assets, receiver, shareOwner);
    }

    function redeem(uint256 shares, address receiver, address shareOwner)
        external
        nonReentrant
        returns (uint256 assets)
    {
        if (shares == 0) revert ZeroAmount();
        uint256 max = maxRedeem(shareOwner);
        if (shares > max) revert ExceedsMaxRedeem(shares, max);

        assets = previewRedeem(shares);
        if (assets == 0) revert ZeroAmount();
        _burnAndPay(shares, assets, receiver, shareOwner);
    }

    // -----------------------------------------------------------------------
    // Fill registry and reimbursement
    // -----------------------------------------------------------------------

    function isFilled(bytes32 intentId) external view returns (bool) {
        return intentFilled[intentId];
    }

    /// @notice The EIP-712 domain separator for this vault on this chain.
    function domainSeparator() public view returns (bytes32) {
        return FillAuthorizationLib.domainSeparator(block.chainid, address(this));
    }

    /// @notice The digest an agent must sign to authorise a fill here.
    function hashFillAuthorization(FillAuthorization memory authorization) public view returns (bytes32) {
        return FillAuthorizationLib.digest(authorization, block.chainid, address(this));
    }

    /// @notice Advance LP capital to a recipient against a signed authorization.
    ///
    /// @dev The agent has no unrestricted way to move vault funds. It signs this
    ///      narrow, short-lived statement about one intent, and every reason to
    ///      refuse is checked here rather than trusted to the agent:
    ///
    ///        expiry, amount consistency, protocol fee ceiling, single-fill cap,
    ///        exposure cap, signer allowlist, agent nonce, intent replay,
    ///        reserve floor and available liquidity.
    ///
    ///      Submission is permissionless. Authority rests on the recovered
    ///      signer, not on `msg.sender`, so any relayer may carry a valid
    ///      authorization and a compromised relayer gains nothing.
    ///
    ///      Checks that cost nothing come before signature recovery; the
    ///      allowlist check comes before any state is written; and state is
    ///      written before the transfer.
    function fastFill(FillAuthorization memory authorization, bytes calldata signature)
        external
        nonReentrant
        returns (address signer)
    {
        if (paused) revert VaultPaused();
        if (authorization.expiry <= block.timestamp) {
            revert AuthorizationExpired(authorization.expiry, block.timestamp);
        }
        // A fill belongs on the chain the intent was *not* created on.
        if (authorization.sourceChainId == block.chainid) {
            revert WrongDestinationChain(authorization.sourceChainId);
        }
        if (authorization.outputAmount + authorization.feeAmount != authorization.inputAmount) {
            revert AmountsInconsistent(
                authorization.inputAmount, authorization.outputAmount, authorization.feeAmount
            );
        }

        uint256 feeCeiling = (authorization.inputAmount * maxFeeBps) / BPS_DENOMINATOR;
        if (authorization.feeAmount > feeCeiling) {
            revert FeeAboveProtocolCeiling(authorization.feeAmount, feeCeiling);
        }
        if (authorization.outputAmount > maxFillAmount) {
            revert FillAboveCap(authorization.outputAmount, maxFillAmount);
        }

        uint256 newExposure = outstandingExposure + authorization.outputAmount;
        if (newExposure > maxOutstandingExposure) {
            revert ExposureCapExceeded(newExposure, maxOutstandingExposure);
        }

        signer = ECDSA.recover(hashFillAuthorization(authorization), signature);
        if (!isAuthorisedSigner[signer]) revert SignerNotAuthorised(signer);

        if (agentNonceUsed[authorization.nonce]) revert AgentNonceAlreadyUsed(authorization.nonce);
        agentNonceUsed[authorization.nonce] = true;

        _recordFastFill(authorization.intentId, authorization.recipient, authorization.outputAmount);

        emit FastFilled(
            authorization.intentId,
            authorization.recipient,
            signer,
            authorization.inputAmount,
            authorization.outputAmount,
            authorization.feeAmount
        );
    }

    /// @dev Records a fast fill and pays the recipient. Marks state before
    ///      transferring, so a hostile token callback cannot re-enter and spend
    ///      the same intent twice.
    ///
    ///      Authorisation of the fill — verifying the agent's EIP-712 signature,
    ///      expiry, nonce and caps — is deliberately not here: it arrives with
    ///      the `fastFill` entry point in WP-05. This internal function is the
    ///      accounting half, so the reimbursement path can be built and tested
    ///      against real state first.
    function _recordFastFill(bytes32 intentId, address recipient, uint256 outputAmount) internal {
        if (intentFilled[intentId]) revert IntentAlreadyFilled(intentId);
        if (recipient == address(0)) revert ZeroAddress();
        if (outputAmount == 0) revert ZeroAmount();

        uint256 available = availableLiquidity();
        if (outputAmount > available) revert InsufficientLiquidity(outputAmount, available);

        intentFilled[intentId] = true;
        advancedPrincipal[intentId] = outputAmount;
        outstandingExposure += outputAmount;

        asset.safeTransfer(recipient, outputAmount);
        emit FillRecorded(intentId, recipient, outputAmount);
    }

    /// @notice Accept canonical funds for a filled intent and clear its receivable.
    /// @dev Only the configured settlement receiver may call this. The amount
    ///      received is the intent's input amount; the exposure cleared is the
    ///      smaller output amount that was advanced. The difference is the
    ///      execution fee, and it accrues to LPs as a share-price increase.
    function recordReimbursement(bytes32 intentId, uint256 amount) external nonReentrant {
        if (msg.sender != settlementReceiver) revert NotSettlementReceiver();
        if (!intentFilled[intentId]) revert IntentNotFilled(intentId);

        uint256 principal = advancedPrincipal[intentId];
        if (principal == 0) revert IntentNotFilled(intentId);
        if (amount < principal) revert ReimbursementBelowPrincipal(amount, principal);

        // The fee is what canonical settlement returned above what was advanced.
        // The protocol's share is booked as a liability; the remainder stays in
        // the vault and lifts the share price, which is how LPs are paid.
        uint256 fee = amount - principal;
        uint256 toProtocol = (fee * protocolFeeShareBps) / BPS_DENOMINATOR;

        advancedPrincipal[intentId] = 0;
        outstandingExposure -= principal;
        accruedProtocolFees += toProtocol;

        asset.safeTransferFrom(msg.sender, address(this), amount);
        emit ReimbursementRecorded(intentId, amount, principal);
        emit FeesAccrued(intentId, toProtocol, fee - toProtocol);
    }

    function _pullAndMint(uint256 assets, uint256 shares, address receiver) private {
        asset.safeTransferFrom(msg.sender, address(this), assets);
        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function _burnAndPay(uint256 shares, uint256 assets, address receiver, address shareOwner) private {
        if (receiver == address(0)) revert ZeroAddress();
        if (msg.sender != shareOwner) _spendAllowance(shareOwner, msg.sender, shares);

        // A receivable is an asset but not a payable one, and protocol fees are
        // held here but are not the LPs' to take.
        uint256 payable_ = lpLiquidBalance();
        if (assets > payable_) revert InsufficientLiquidity(assets, payable_);

        _burn(shareOwner, shares);
        asset.safeTransfer(receiver, assets);
        emit Withdraw(msg.sender, receiver, shareOwner, assets, shares);
    }
}
