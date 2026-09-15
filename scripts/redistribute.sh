#!/usr/bin/env bash
# Redistribute the deployer's USDC across the market — vault depth first, then the generator's
# working capital. Every transfer is signed by the `deployKey` keystore (one password prompt per
# transaction; cast caches nothing, so expect to type it once per line).
#
#   scripts/redistribute.sh --dry-run    # print the plan and stop
#   scripts/redistribute.sh              # confirm, then send
#   VAULT_HOUSE=200 scripts/redistribute.sh   # override any amount below
#
# Uniswap pool depth is deliberately NOT here: adding liquidity mints matching mock tokens and
# moves prices, so it lives in the market repo (see the note at the end of this file).
#
# What this does, and why:
#   * Vault deposits mint the deployer ERC-4626 shares; the capital is lent to recipients on a
#     fast fill and returned with the fee by canonical settlement. It compounds rather than
#     being consumed, so it is the highest-value place to put USDC.
#   * Generator top-ups are working capital that circulates; it leaks into mock tokens on trade
#     intents, which the generator's own sweep converts back every 30 minutes.
set -euo pipefail

DEPLOYER=0x538e5E9797fa86eE25e97289439b6A3AbA0165b0
SEPOLIA_RPC=${ETHEREUM_SEPOLIA_RPC_URL:-https://ethereum-sepolia-rpc.publicnode.com}
ARC_RPC=${ARC_TESTNET_RPC_URL:-https://arc-testnet.drpc.org}
USDC_SEPOLIA=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
USDC_ARC=0x3600000000000000000000000000000000000000

# Vaults (deposit → shares for the deployer)
HOUSE_ARC=0xB4bA190D5C78869366e7963f5CcCf4c3167d855C
HOUSE_SEPOLIA=0xB4bA190D5C78869366e7963f5CcCf4c3167d855C
VAULT_B_ARC=0x73e0b52C68F5912544C176D265782133947b68fc
VAULT_C_ARC=0x180d1c22a41c2E43b9a9086a3C4B2a37fBa8E5Ae
VAULT_B_SEPOLIA=0x8c924cA38856f4Fdb2e8f672Fd0084689B1EE47B
VAULT_C_SEPOLIA=0x3d11E0452a154CF6255F5E12Fb56E361832Da203

# Generator wallets (plain transfers)
BOT1=0xd2A11B3d4A71Cad528E13e868401F2534881937C
BOT2=0x2A450f96a8C4890CDdf280ADA297519dab2E3F95

# --- amounts, in whole USDC; override any of them from the environment -------------------------
VAULT_HOUSE_ARC=${VAULT_HOUSE_ARC:-250}
VAULT_HOUSE_SEPOLIA=${VAULT_HOUSE_SEPOLIA:-250}
VAULT_B=${VAULT_B:-150}          # each chain
VAULT_C=${VAULT_C:-150}          # each chain
BOT_TOPUP=${BOT_TOPUP:-150}      # each bot, each chain
DRY=${1:-}

units() { python3 -c "print(int($1 * 10**6))"; }

plan() {
  echo "from $DEPLOYER"
  echo
  echo "  Arc vault deposits (deployer receives shares):"
  echo "    House Vault      $VAULT_HOUSE_ARC USDC   -> $HOUSE_ARC"
  echo "    Moody (B)        $VAULT_B USDC   -> $VAULT_B_ARC"
  echo "    Skylight (C)     $VAULT_C USDC   -> $VAULT_C_ARC"
  echo "  Sepolia vault deposits:"
  echo "    House Vault      $VAULT_HOUSE_SEPOLIA USDC   -> $HOUSE_SEPOLIA"
  echo "    Moody (B)        $VAULT_B USDC   -> $VAULT_B_SEPOLIA"
  echo "    Skylight (C)     $VAULT_C USDC   -> $VAULT_C_SEPOLIA"
  echo "  Generator working capital (plain transfers):"
  echo "    bot #1           $BOT_TOPUP USDC on each chain"
  echo "    bot #2           $BOT_TOPUP USDC on each chain"
  echo
  local arc sep
  arc=$(python3 -c "print($VAULT_HOUSE_ARC + $VAULT_B + $VAULT_C + 2*$BOT_TOPUP)")
  sep=$(python3 -c "print($VAULT_HOUSE_SEPOLIA + $VAULT_B + $VAULT_C + 2*$BOT_TOPUP)")
  echo "  total: $arc USDC on Arc, $sep USDC on Sepolia"
  echo
  echo "  NOT included: Sepolia ETH for gas (use a faucet -> $DEPLOYER, then scripts/fund-bots.sh),"
  echo "                Uniswap pool depth (see the note at the end of this script)."
}

deposit() { # rpc, usdc, vault, whole-usdc, label
  local rpc=$1 usdc=$2 vault=$3 amount=$4 label=$5 u
  u=$(units "$amount")
  echo "-- $label: approve $amount USDC"
  cast send "$usdc" "approve(address,uint256)" "$vault" "$u" --rpc-url "$rpc" --account deployKey -f "$DEPLOYER" | grep -E "^status|^transactionHash"
  echo "-- $label: deposit $amount USDC"
  cast send "$vault" "deposit(uint256,address)" "$u" "$DEPLOYER" --rpc-url "$rpc" --account deployKey -f "$DEPLOYER" | grep -E "^status|^transactionHash"
}

send_usdc() { # rpc, usdc, to, whole-usdc, label
  local rpc=$1 usdc=$2 to=$3 amount=$4 label=$5 u
  u=$(units "$amount")
  echo "-- $label: $amount USDC"
  cast send "$usdc" "transfer(address,uint256)" "$to" "$u" --rpc-url "$rpc" --account deployKey -f "$DEPLOYER" | grep -E "^status|^transactionHash"
}

plan
if [ "$DRY" = "--dry-run" ]; then echo "dry run — nothing sent."; exit 0; fi
read -r -p "send these? [y/N] " reply
[ "$reply" = "y" ] || { echo "cancelled."; exit 0; }

deposit "$ARC_RPC" "$USDC_ARC" "$HOUSE_ARC" "$VAULT_HOUSE_ARC" "Arc House Vault"
deposit "$ARC_RPC" "$USDC_ARC" "$VAULT_B_ARC" "$VAULT_B" "Arc Moody (B)"
deposit "$ARC_RPC" "$USDC_ARC" "$VAULT_C_ARC" "$VAULT_C" "Arc Skylight (C)"
deposit "$SEPOLIA_RPC" "$USDC_SEPOLIA" "$HOUSE_SEPOLIA" "$VAULT_HOUSE_SEPOLIA" "Sepolia House Vault"
deposit "$SEPOLIA_RPC" "$USDC_SEPOLIA" "$VAULT_B_SEPOLIA" "$VAULT_B" "Sepolia Moody (B)"
deposit "$SEPOLIA_RPC" "$USDC_SEPOLIA" "$VAULT_C_SEPOLIA" "$VAULT_C" "Sepolia Skylight (C)"
send_usdc "$ARC_RPC" "$USDC_ARC" "$BOT1" "$BOT_TOPUP" "bot #1 on Arc"
send_usdc "$ARC_RPC" "$USDC_ARC" "$BOT2" "$BOT_TOPUP" "bot #2 on Arc"
send_usdc "$SEPOLIA_RPC" "$USDC_SEPOLIA" "$BOT1" "$BOT_TOPUP" "bot #1 on Sepolia"
send_usdc "$SEPOLIA_RPC" "$USDC_SEPOLIA" "$BOT2" "$BOT_TOPUP" "bot #2 on Sepolia"

echo
echo "done. Check the result with:  pnpm exec tsx scripts/balance-watch.ts --once"
echo
echo "Uniswap pool depth is a separate job: each pool holds ~40 USDC, which is why trade intents"
echo "are capped at 1–8 USDC. Deepening them means addLiquidity with matching minted mock tokens"
echo "in the market repo (~/code/uniswap-v2). Ask before running that — it moves prices."
