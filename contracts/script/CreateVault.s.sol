// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ArcaidiaLiquidityVault} from "../src/ArcaidiaLiquidityVault.sol";
import {ArcaidiaVaultFactory} from "../src/ArcaidiaVaultFactory.sol";
import {FeePolicy} from "../src/libraries/ArcaidiaTypes.sol";

/// @notice An independent operator creates their own standard vault through the factory (D10)
///         and authorises their own solver signer — no Arcaidia key anywhere in this run.
///
/// @dev Usage (the operator's own key; plaintext via env, as an operator would in CI):
///        OPERATOR_PRIVATE_KEY=0x… VAULT_LABEL="Vault B" SOLVER_SIGNER_ADDRESS=0x… \
///        FEE_BASE_BPS=… forge script script/CreateVault.s.sol --rpc-url … --broadcast
///      The same salt (derived from the label) on both chains with the same operator key gives the
///      vault the same address on Ethereum and Arc — the factory is CREATE2 and salts by creator.
contract CreateVaultScript is Script {
    /// @dev v2 factory, identical on Ethereum Sepolia and Arc testnet (WP-31, 2026-09-12).
    address internal constant DEFAULT_FACTORY = 0xD458d83C874296EC4a29c47655Ae47302879b23a;

    function run() external {
        uint256 operatorKey = vm.envUint("OPERATOR_PRIVATE_KEY");
        address operator = vm.addr(operatorKey);
        ArcaidiaVaultFactory factory = ArcaidiaVaultFactory(vm.envOr("VAULT_FACTORY", DEFAULT_FACTORY));
        string memory label = vm.envString("VAULT_LABEL");
        address signer = vm.envOr("SOLVER_SIGNER_ADDRESS", address(0));

        FeePolicy memory policy = FeePolicy({
            baseFeeBps: uint16(vm.envUint("FEE_BASE_BPS")),
            midFeeBps: uint16(vm.envUint("FEE_MID_BPS")),
            highFeeBps: uint16(vm.envUint("FEE_HIGH_BPS")),
            criticalFeeBps: uint16(vm.envUint("FEE_CRITICAL_BPS")),
            midThresholdBps: uint16(vm.envUint("FEE_MID_THRESHOLD_BPS")),
            highThresholdBps: uint16(vm.envUint("FEE_HIGH_THRESHOLD_BPS")),
            criticalThresholdBps: uint16(vm.envUint("FEE_CRITICAL_THRESHOLD_BPS"))
        });
        uint16 reserveFloorBps = uint16(vm.envOr("RESERVE_FLOOR_BPS", uint256(1_000)));
        uint16 maxFillBps = uint16(vm.envOr("MAX_FILL_BPS", uint256(5_000)));
        uint16 maxExposureBps = uint16(vm.envOr("MAX_EXPOSURE_BPS", uint256(8_000)));
        bytes32 salt = keccak256(bytes(label));

        address predicted = factory.predictVault(operator, salt);
        console.log("chain id        ", block.chainid);
        console.log("operator/owner  ", operator);
        console.log("factory         ", address(factory));
        console.log("label           ", label);
        console.log("predicted vault ", predicted);

        vm.startBroadcast(operatorKey);
        address vault = factory.createVault(salt, reserveFloorBps, maxFillBps, maxExposureBps, policy, label);
        if (signer != address(0)) ArcaidiaLiquidityVault(vault).setAuthorisedSigner(signer, true);
        vm.stopBroadcast();

        require(vault == predicted, "vault landed off its prediction");
        require(factory.isFactoryVault(vault), "factory did not register the vault");
        console.log("--- created ---");
        console.log("vault           ", vault);
        console.log("owner           ", ArcaidiaLiquidityVault(vault).owner());
        console.log("current fee bps ", ArcaidiaLiquidityVault(vault).currentFeeBps());
        if (signer != address(0)) console.log("signer authorised", signer);
    }
}
