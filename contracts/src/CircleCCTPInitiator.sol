// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISettlementInitiator} from "./interfaces/ISettlementInitiator.sol";
import {ITokenMessengerV2} from "./interfaces/ITokenMessengerV2.sol";

/// @title CircleCCTPInitiator
/// @notice Real canonical settlement transport: burns via Circle's CCTP V2
///         `TokenMessengerV2`, replacing `MockSettlementInitiator` (WP-06).
///         Since WP-25 it carries the router's intent hook in the burn message
///         (`depositForBurnWithHook`) so the destination can associate the
///         canonical mint with its intent from attested bytes (DECISIONS.md D8).
/// @dev The router pulls no design knowledge of CCTP from this — it only sees
///      `ISettlementInitiator`. Everything CCTP-specific (domains, finality,
///      fee) lives here and in `CircleCCTPAdapter` on the destination side.
///
///      Standard (finalized) transfers only: `minFinalityThreshold` defaults to
///      2000 and `maxFee` to 0. Circle's CCTP V2 charges fees on Fast Transfers
///      only — Standard transfers are free — so a Fast transfer is never the
///      right choice for a leg the fast layer has already made instant; the
///      canonical leg's job is to be correct and free, not fast. Both remain
///      owner-configurable in case that trade-off is ever revisited, but
///      neither the router nor `ISettlementInitiator` has room for a per-call
///      override, so any change here applies to every settlement.
///
///      Domains are owner-configured per destination chain id rather than
///      derived, because Circle's CCTP domain ids are an allocation with no
///      formula relating them to EVM chain ids (Ethereum happens to be domain
///      0 — indistinguishable from "unconfigured" — which is exactly why this
///      uses an explicit `domainConfigured` map instead of treating 0 as a
///      sentinel).
contract CircleCCTPInitiator is ISettlementInitiator {
    using SafeERC20 for IERC20;

    ITokenMessengerV2 public immutable tokenMessenger;
    IERC20 public immutable settlementAsset;

    address public owner;

    /// @notice Standard/finalized by default (2000). Fast is 1000 or below.
    uint32 public minFinalityThreshold = 2000;
    /// @notice In units of `settlementAsset`. 0 is correct for Standard transfers.
    uint256 public maxFee = 0;

    mapping(uint256 => uint32) public domainFor;
    mapping(uint256 => bool) public domainConfigured;

    uint256 private _refNonce;

    event DomainConfigured(uint256 indexed destinationChainId, uint32 domain);
    event FinalityConfigured(uint32 minFinalityThreshold, uint256 maxFee);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event SettlementInitiated(
        bytes32 indexed intentId, bytes32 settlementRef, uint256 amount, uint256 destinationChainId
    );

    error NotOwner();
    error ZeroAddress();
    error UnsupportedDestination(uint256 destinationChainId);
    error AssetMismatch(address expected, address actual);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address owner_, address tokenMessenger_, address settlementAsset_) {
        if (owner_ == address(0) || tokenMessenger_ == address(0) || settlementAsset_ == address(0)) {
            revert ZeroAddress();
        }
        owner = owner_;
        tokenMessenger = ITokenMessengerV2(tokenMessenger_);
        settlementAsset = IERC20(settlementAsset_);
    }

    /// @notice Register the CCTP domain for a destination chain this router will target.
    function setDomain(uint256 destinationChainId, uint32 domain) external onlyOwner {
        domainFor[destinationChainId] = domain;
        domainConfigured[destinationChainId] = true;
        emit DomainConfigured(destinationChainId, domain);
    }

    /// @notice Adjust the finality/fee trade-off. See the contract-level note above.
    function setFinality(uint32 minFinalityThreshold_, uint256 maxFee_) external onlyOwner {
        minFinalityThreshold = minFinalityThreshold_;
        maxFee = maxFee_;
        emit FinalityConfigured(minFinalityThreshold_, maxFee_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @inheritdoc ISettlementInitiator
    function supportsDestination(uint256 destinationChainId) external view returns (bool) {
        return domainConfigured[destinationChainId];
    }

    /// @inheritdoc ISettlementInitiator
    /// @dev With `hookData` (the router's normal path, WP-25 / D8) this burns through
    ///      `depositForBurnWithHook` and names `destinationReceiver` as the
    ///      `destinationCaller`: only that contract may `receiveMessage` on the
    ///      destination, so the mint and its routing become one atomic, permissionless
    ///      `SettlementReceiver.settleWithProof` call — no race with a third party
    ///      calling `receiveMessage` first, and the attested `hookData` is what the
    ///      receiver routes by. That is safe, not a lockout, precisely because
    ///      `settleWithProof` needs no key: anyone holding the public attestation can
    ///      submit it. An empty `hookData` keeps the v1 behaviour (hookless burn,
    ///      `destinationCaller = 0`, reporter-driven settlement) for any caller that
    ///      has nothing to carry.
    function initiateSettlement(
        address asset,
        uint256 amount,
        uint256 destinationChainId,
        address destinationReceiver,
        bytes32 intentId,
        bytes calldata hookData
    ) external returns (bytes32 settlementRef) {
        if (!domainConfigured[destinationChainId]) {
            revert UnsupportedDestination(destinationChainId);
        }
        if (asset != address(settlementAsset)) revert AssetMismatch(address(settlementAsset), asset);

        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);

        IERC20(asset).forceApprove(address(tokenMessenger), amount);
        if (hookData.length > 0) {
            tokenMessenger.depositForBurnWithHook(
                amount,
                domainFor[destinationChainId],
                _toBytes32(destinationReceiver),
                asset,
                _toBytes32(destinationReceiver),
                maxFee,
                minFinalityThreshold,
                hookData
            );
        } else {
            tokenMessenger.depositForBurn(
                amount,
                domainFor[destinationChainId],
                _toBytes32(destinationReceiver),
                asset,
                bytes32(0),
                maxFee,
                minFinalityThreshold
            );
        }
        IERC20(asset).forceApprove(address(tokenMessenger), 0);

        settlementRef = keccak256(abi.encode(intentId, destinationChainId, destinationReceiver, _refNonce++));
        emit SettlementInitiated(intentId, settlementRef, amount, destinationChainId);
    }

    function _toBytes32(address addr) private pure returns (bytes32) {
        return bytes32(uint256(uint160(addr)));
    }
}
