// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ArcaidiaLiquidityVault} from "./ArcaidiaLiquidityVault.sol";
import {IVaultRegistry} from "./interfaces/IVaultRegistry.sol";
import {FeePolicy} from "./libraries/ArcaidiaTypes.sol";

/// @title ArcaidiaVaultFactory
/// @notice Permissionless creation of standard `ArcaidiaLiquidityVault`s (DECISIONS.md D10),
///         and the registry the market consults before letting a vault claim an intent (D11).
///
/// @dev **Why the factory embeds the vault's init code rather than taking it as calldata.**
///      The market reimburses whichever address won an intent by approving it and calling
///      `recordReimbursement`. That is only safe if the winner is a *standard* vault — one that
///      accepts reimbursement solely for intents it actually paid out. A factory that deployed
///      caller-supplied code could not promise that; one that deploys `type(ArcaidiaLiquidityVault)
///      .creationCode` can, by construction. Anyone may create a vault; nobody can create a
///      non-standard one and have the market treat it as one.
///
///      **Why CREATE2 salted by creator.** `predictVault(creator, salt)` lets a deployment
///      script — and the frontend — know a vault's address before creating it, and because the
///      factory itself is CREATE2-deployed at one address on every chain, the same creator and
///      salt yield the same vault address on Ethereum and Arc. Salting by `msg.sender` means no
///      one can front-run another creator's address.
///
///      Constructor takes no arguments (CREATE2 parity); wiring arrives through `initialize`,
///      deployed-and-initialised atomically by `ArcaidiaDeployer`.
contract ArcaidiaVaultFactory is IVaultRegistry {
    address public owner;
    bool public initialized;

    address public asset;
    address public market;
    address public settlementReceiver;

    mapping(address => bool) public isFactoryVault;
    address[] public vaults;

    event FactoryInitialized(address owner, address asset, address market, address settlementReceiver);
    event VaultCreated(
        address indexed vault,
        address indexed owner,
        string label,
        FeePolicy policy,
        uint16 reserveFloorBps,
        uint16 maxFillBps,
        uint16 maxExposureBps
    );
    event OwnerTransferred(address indexed previousOwner, address indexed newOwner);

    error AlreadyInitialized();
    error NotOwner();
    error ZeroAddress();
    error VaultAddressMismatch(address predicted, address actual);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function initialize(address owner_, address asset_, address market_, address settlementReceiver_) external {
        if (initialized) revert AlreadyInitialized();
        if (
            owner_ == address(0) || asset_ == address(0) || market_ == address(0)
                || settlementReceiver_ == address(0)
        ) revert ZeroAddress();

        initialized = true;
        owner = owner_;
        asset = asset_;
        market = market_;
        settlementReceiver = settlementReceiver_;

        emit FactoryInitialized(owner_, asset_, market_, settlementReceiver_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnerTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @notice Create a standard vault owned by the caller, wired to this chain's market and
    ///         settlement receiver, with its economics fixed at creation.
    /// @param salt Caller-chosen; the vault lands at `predictVault(msg.sender, salt)`.
    /// @param label A human label carried in the event only — not read on chain.
    function createVault(
        bytes32 salt,
        uint16 reserveFloorBps,
        uint16 maxFillBps,
        uint16 maxExposureBps,
        FeePolicy calldata policy,
        string calldata label
    ) external returns (address vault) {
        address predicted = predictVault(msg.sender, salt);

        ArcaidiaLiquidityVault created = new ArcaidiaLiquidityVault{salt: _fullSalt(msg.sender, salt)}();
        vault = address(created);
        if (vault != predicted) revert VaultAddressMismatch(predicted, vault);

        // Same transaction as the deploy: no window in which anyone else could initialise it.
        created.initialize(address(this), asset, reserveFloorBps, maxFillBps, maxExposureBps, policy);
        created.setMarket(market);
        created.setSettlementReceiver(settlementReceiver);
        created.transferOwnership(msg.sender);

        isFactoryVault[vault] = true;
        vaults.push(vault);

        emit VaultCreated(vault, msg.sender, label, policy, reserveFloorBps, maxFillBps, maxExposureBps);
    }

    /// @notice Where `creator`'s vault for `salt` lands (or landed).
    function predictVault(address creator, bytes32 salt) public view returns (address) {
        return address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            bytes1(0xff),
                            address(this),
                            _fullSalt(creator, salt),
                            keccak256(type(ArcaidiaLiquidityVault).creationCode)
                        )
                    )
                )
            )
        );
    }

    function vaultCount() external view returns (uint256) {
        return vaults.length;
    }

    function _fullSalt(address creator, bytes32 salt) private pure returns (bytes32) {
        return keccak256(abi.encode(creator, salt));
    }
}
