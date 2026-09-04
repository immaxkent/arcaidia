// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title ArcaidiaDeployer
/// @notice Deterministic deployment with atomic initialization.
///
/// @dev Arcaidia's contracts take no constructor arguments, so their init code —
///      and therefore their CREATE2 address — is identical on every chain. The
///      cost of that choice is that configuration arrives through a separate
///      `initialize` call, which leaves a window in which anyone could
///      initialize a freshly deployed contract and seize it.
///
///      This contract closes that window: `deploy` performs the CREATE2 and the
///      initialization in one transaction, so there is no intermediate state for
///      anyone to exploit. It also asserts the deployed address against the
///      predicted one before returning, which is the acceptance criterion for
///      WP-01 rather than an optional check.
///
///      The deployer itself must live at the same address on every chain, so it
///      is deployed through Arachnid's canonical CREATE2 proxy at
///      `0x4e59b44847b379578588920cA78FbF26c0B4956C` — verified present on both
///      Ethereum Sepolia and Arc testnet. Its own creation code takes no
///      arguments, so that address is chain-independent too.
contract ArcaidiaDeployer {
    event Deployed(bytes32 indexed salt, address indexed deployed, bool initialized);

    error DeploymentFailed(bytes32 salt);
    error AddressMismatch(address predicted, address actual);
    error InitializationFailed(address deployed, bytes reason);
    error EmptyCreationCode();

    /// @notice Deploy `creationCode` at a deterministic address and initialize it.
    /// @param salt CREATE2 salt. The same salt and creation code must be used on
    ///        every chain for the addresses to match.
    /// @param creationCode Contract init code. Must carry no chain-specific
    ///        constructor arguments, or the address will differ per chain.
    /// @param initCall ABI-encoded call executed on the new contract in the same
    ///        transaction. Pass empty bytes to skip.
    function deploy(bytes32 salt, bytes memory creationCode, bytes memory initCall)
        external
        returns (address deployed)
    {
        if (creationCode.length == 0) revert EmptyCreationCode();

        address predicted = predictAddress(salt, keccak256(creationCode));

        assembly {
            deployed := create2(0, add(creationCode, 0x20), mload(creationCode), salt)
        }
        if (deployed == address(0)) revert DeploymentFailed(salt);
        if (deployed != predicted) revert AddressMismatch(predicted, deployed);

        bool didInitialize = initCall.length > 0;
        if (didInitialize) {
            (bool ok, bytes memory reason) = deployed.call(initCall);
            if (!ok) revert InitializationFailed(deployed, reason);
        }

        emit Deployed(salt, deployed, didInitialize);
    }

    /// @notice The address `creationCode` will occupy for a given salt.
    /// @dev Depends only on this deployer's address, the salt and the init-code
    ///      hash. It does not depend on `block.chainid`, which is precisely why
    ///      the same inputs produce the same address on Ethereum and Arc.
    function predictAddress(bytes32 salt, bytes32 creationCodeHash) public view returns (address) {
        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, creationCodeHash))))
        );
    }

    /// @notice Convenience overload taking raw creation code.
    function predictAddressFor(bytes32 salt, bytes memory creationCode) external view returns (address) {
        return predictAddress(salt, keccak256(creationCode));
    }

    /// @notice Whether a contract already occupies the predicted address.
    function isDeployed(bytes32 salt, bytes32 creationCodeHash) external view returns (bool) {
        address target = predictAddress(salt, creationCodeHash);
        return target.code.length > 0;
    }
}
