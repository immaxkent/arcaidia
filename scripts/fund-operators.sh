#!/usr/bin/env bash
# Gas top-ups for the independent solver operators (WP-31). Vault capital is deposited by each
# vault's *owner* (the wallet used on /earn); the operator's submitter key only needs gas to
# broadcast fills. Signer keys need nothing. Uses the deployer keystore (`deployKey`) — one
# password prompt per transfer.
#
#   scripts/fund-operators.sh                    # both operators, both chains
#   SEPOLIA_ETH=0.03 ARC_USDC=3 scripts/fund-operators.sh
set -euo pipefail
DEPLOYER=0x538e5E9797fa86eE25e97289439b6A3AbA0165b0
SEPOLIA_RPC=${SEPOLIA_RPC:-https://ethereum-sepolia-rpc.publicnode.com}
ARC_RPC=${ARC_RPC:-https://arc-testnet.drpc.org}
SEPOLIA_ETH=${SEPOLIA_ETH:-0.02}   # ether, for fill gas on Sepolia
ARC_USDC=${ARC_USDC:-2}            # USDC (Arc's native gas), for fill gas on Arc

submitter() { grep -E "^LOCAL_SUBMITTER_PRIVATE_KEY=" ".env.solver-$1" | cut -d= -f2 | xargs cast wallet address --private-key; }

for op in b c; do
  addr=$(submitter "$op")
  echo "== operator $op submitter $addr"
  echo "-- Sepolia: $SEPOLIA_ETH ETH"
  cast send "$addr" --value "${SEPOLIA_ETH}ether" --rpc-url "$SEPOLIA_RPC" --account deployKey -f "$DEPLOYER" | grep -E "status|transactionHash"
  echo "-- Arc: $ARC_USDC USDC (native gas)"
  cast send "$addr" --value "${ARC_USDC}ether" --rpc-url "$ARC_RPC" --account deployKey -f "$DEPLOYER" | grep -E "status|transactionHash"
done
echo "done. balances:"
for op in b c; do
  addr=$(submitter "$op")
  echo "  $op $addr  sepolia $(cast balance "$addr" --rpc-url "$SEPOLIA_RPC" --ether) ETH  arc $(cast balance "$addr" --rpc-url "$ARC_RPC" --ether) USDC"
done
