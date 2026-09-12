#!/usr/bin/env bash
# Fund the load generator's user-bot wallets (WP-32) from the deployer keystore: USDC to
# transfer with plus gas, on both chains. One password prompt per transfer (8 total).
#
#   scripts/fund-loadgen.sh                          # 100 USDC + gas per bot per chain
#   USDC_PER_BOT=50 SEPOLIA_ETH=0.03 ARC_GAS=3 scripts/fund-loadgen.sh
set -euo pipefail
DEPLOYER=0x538e5E9797fa86eE25e97289439b6A3AbA0165b0
SEPOLIA_RPC=${SEPOLIA_RPC:-https://ethereum-sepolia-rpc.publicnode.com}
ARC_RPC=${ARC_RPC:-https://arc-testnet.drpc.org}
USDC_SEPOLIA=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
USDC_ARC=0x3600000000000000000000000000000000000000
USDC_PER_BOT=${USDC_PER_BOT:-100}
SEPOLIA_ETH=${SEPOLIA_ETH:-0.05}
ARC_GAS=${ARC_GAS:-5}
bots=$(grep -E "^LOADGEN_USER_KEYS=" .env.loadgen | cut -d= -f2 | tr ',' '\n' | xargs -I{} cast wallet address --private-key {})
usdc_units=$(python3 -c "print(int($USDC_PER_BOT * 10**6))")
for addr in $bots; do
  echo "== bot $addr"
  echo "-- Sepolia: $USDC_PER_BOT USDC + $SEPOLIA_ETH ETH"
  cast send "$USDC_SEPOLIA" "transfer(address,uint256)" "$addr" "$usdc_units" --rpc-url "$SEPOLIA_RPC" --account deployKey -f "$DEPLOYER" | grep -E "status|transactionHash"
  cast send "$addr" --value "${SEPOLIA_ETH}ether" --rpc-url "$SEPOLIA_RPC" --account deployKey -f "$DEPLOYER" | grep -E "status|transactionHash"
  echo "-- Arc: $USDC_PER_BOT USDC (ERC-20) + $ARC_GAS USDC (native gas)"
  cast send "$USDC_ARC" "transfer(address,uint256)" "$addr" "$usdc_units" --rpc-url "$ARC_RPC" --account deployKey -f "$DEPLOYER" | grep -E "status|transactionHash"
  cast send "$addr" --value "${ARC_GAS}ether" --rpc-url "$ARC_RPC" --account deployKey -f "$DEPLOYER" | grep -E "status|transactionHash"
done
echo "done. balances:"
for addr in $bots; do
  echo "  $addr  sepolia $(cast call $USDC_SEPOLIA 'balanceOf(address)(uint256)' $addr --rpc-url $SEPOLIA_RPC) USDC-units / $(cast balance $addr --rpc-url $SEPOLIA_RPC -e) ETH · arc $(cast call $USDC_ARC 'balanceOf(address)(uint256)' $addr --rpc-url $ARC_RPC) USDC-units / $(cast balance $addr --rpc-url $ARC_RPC -e) gas"
done
