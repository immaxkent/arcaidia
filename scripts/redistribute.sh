#!/usr/bin/env bash
# Bring every wallet and vault in the market up to a target, from the deployer keystore.
#
#   scripts/redistribute.sh --dry-run    # read the chain, print what is missing, stop
#   scripts/redistribute.sh              # confirm, then send only the shortfalls
#   TARGET_HOUSE=900 scripts/redistribute.sh   # override any target below
#
# Targets, not transfers. Every line reads the chain first and sends only the difference, so a
# run that dies halfway (an RPC timeout mid-deposit is how this script earned its rewrite) is
# resumed by running it again, and running it twice in a row sends nothing the second time.
# Each call is retried three times before giving up on that line and carrying on with the rest.
#
# Vault deposits mint the deployer ERC-4626 shares: the capital is lent out on a fast fill and
# returned with the fee by canonical settlement, so it compounds rather than being spent. Bot
# USDC is working capital that circulates; the generator's own sweep recovers what trade intents
# leak into mock tokens. Gas is pure consumption and the only thing a faucet has to replace.
set -uo pipefail

DEPLOYER=0x538e5E9797fa86eE25e97289439b6A3AbA0165b0
SEPOLIA_RPC=${ETHEREUM_SEPOLIA_RPC_URL:-https://ethereum-sepolia-rpc.publicnode.com}
ARC_RPC=${ARC_TESTNET_RPC_URL:-https://arc-testnet.drpc.org}
USDC_SEPOLIA=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
USDC_ARC=0x3600000000000000000000000000000000000000

# --- targets, in whole USDC (vault total assets) and ETH (wallet gas) ------------------------
TARGET_HOUSE=${TARGET_HOUSE:-700}        # each chain
TARGET_B=${TARGET_B:-500}                # each chain
TARGET_C=${TARGET_C:-500}                # each chain
TARGET_D=${TARGET_D:-200}                # Sepolia only (the Earn-created vault)
TARGET_BOT=${TARGET_BOT:-400}            # each bot, each chain — in-flight volume is bot money
TARGET_GAS=${TARGET_GAS:-0.05}           # each Sepolia signer
TARGET_GAS_MARKET=${TARGET_GAS_MARKET:-0.08}
DRY=${1:-}

# vaults: chain|label|address
VAULTS_SEPOLIA="House|0xB4bA190D5C78869366e7963f5CcCf4c3167d855C|$TARGET_HOUSE
Moody (B)|0x8c924cA38856f4Fdb2e8f672Fd0084689B1EE47B|$TARGET_B
Skylight (C)|0x3d11E0452a154CF6255F5E12Fb56E361832Da203|$TARGET_C
Your vault (D)|0xc13ED8AF3f9B23E33Dc193754BaB6293CFB5CA35|$TARGET_D"
VAULTS_ARC="House|0xB4bA190D5C78869366e7963f5CcCf4c3167d855C|$TARGET_HOUSE
Moody (B)|0x73e0b52C68F5912544C176D265782133947b68fc|$TARGET_B
Skylight (C)|0x180d1c22a41c2E43b9a9086a3C4B2a37fBa8E5Ae|$TARGET_C"

BOT1=0xd2A11B3d4A71Cad528E13e868401F2534881937C
BOT2=0x2A450f96a8C4890CDdf280ADA297519dab2E3F95
GAS_WALLETS="House submitter|0x21F6A2feb26c2da068C47DDfd85FDde429931cf2|$TARGET_GAS
settlement reporter|0x1BBCcFc2CC7Ff7296e3E18646218211631De9862|$TARGET_GAS
B submitter|0x90f9Cc769bDffAac58510839F7E1E9516a783F90|$TARGET_GAS
C submitter|0xDfCD3f8983e33D607a4cd96c38bd673bff9079cC|$TARGET_GAS
D submitter|0xC3D02b3504a98b29d79E277F2e9f5a89DD096B29|$TARGET_GAS
bot #1|$BOT1|$TARGET_GAS
bot #2|$BOT2|$TARGET_GAS
market bot|0x387297228f13d72c778A205A242a48C6364F7EcB|$TARGET_GAS_MARKET"

# --- chain reads, retried: a timeout must not be mistaken for a zero balance ------------------
read_retry() { # rpc, address, signature, [arg]
  local rpc=$1 addr=$2 sig=$3 arg=${4:-} out i
  for i in 1 2 3; do
    if [ -n "$arg" ]; then out=$(cast call "$addr" "$sig" "$arg" --rpc-url "$rpc" 2>/dev/null)
    else out=$(cast call "$addr" "$sig" --rpc-url "$rpc" 2>/dev/null); fi
    [ -n "$out" ] && { echo "${out%% *}"; return 0; }
    sleep 2
  done
  echo "READ_FAILED"; return 1
}
eth_of() { cast balance "$1" --rpc-url "$2" 2>/dev/null || echo "READ_FAILED"; }
whole() { python3 -c "print(f'{$1/10**$2:.2f}')"; }
short() { python3 -c "d=$1-$2; print(f'{d:.2f}' if d > 0.009 else '0')"; }
units() { python3 -c "print(int(round($1 * 10**$2)))"; }

send_retry() { # label, then the cast send argv
  local label=$1; shift
  local i
  for i in 1 2 3; do
    if "$@" 2>&1 | grep -qE "^status +1"; then echo "   ok"; return 0; fi
    echo "   attempt $i failed; retrying"; sleep 4
  done
  echo "   !! $label failed three times — rerun the script to pick it up"; return 1
}

deposit_to() { # rpc, usdc, vault, whole-usdc, label
  local rpc=$1 usdc=$2 vault=$3 amount=$4 label=$5 u
  u=$(units "$amount" 6)
  echo "-- $label: deposit $amount USDC"
  send_retry "$label approve" cast send "$usdc" "approve(address,uint256)" "$vault" "$u" --rpc-url "$rpc" --account deployKey -f "$DEPLOYER" || return 1
  send_retry "$label deposit" cast send "$vault" "deposit(uint256,address)" "$u" "$DEPLOYER" --rpc-url "$rpc" --account deployKey -f "$DEPLOYER"
}
send_usdc() { # rpc, usdc, to, whole-usdc, label
  local u; u=$(units "$4" 6)
  echo "-- $5: $4 USDC"
  send_retry "$5" cast send "$2" "transfer(address,uint256)" "$3" "$u" --rpc-url "$1" --account deployKey -f "$DEPLOYER"
}
send_eth() { # to, whole-eth, label
  echo "-- gas $3: $2 ETH"
  send_retry "$3" cast send "$1" --value "${2}ether" --rpc-url "$SEPOLIA_RPC" --account deployKey -f "$DEPLOYER"
}

# --- work out the shortfalls -------------------------------------------------------------------
echo "reading the chain…"
PLAN_FILE=$(mktemp); TOTAL_SEP=0; TOTAL_ARC=0; TOTAL_ETH=0
plan_line() { printf '%s\n' "$1" >> "$PLAN_FILE"; }

scan_vaults() { # chain, rpc, usdc, vault-list
  local chain=$1 rpc=$2 usdc=$3 list=$4 label addr target have need
  while IFS='|' read -r label addr target; do
    [ -z "$label" ] && continue
    have=$(read_retry "$rpc" "$addr" 'totalAssets()(uint256)')
    if [ "$have" = "READ_FAILED" ]; then plan_line "  ?? $chain $label: could not read, skipping"; continue; fi
    have=$(whole "$have" 6); need=$(short "$target" "$have")
    if [ "$need" = "0" ]; then plan_line "  ok $chain vault $label: $have / $target USDC"
    else
      plan_line "  -> $chain vault $label: $have / $target USDC, deposit $need"
      echo "VAULT|$chain|$rpc|$usdc|$addr|$need|$chain $label" >> "$PLAN_FILE.do"
      if [ "$chain" = sepolia ]; then TOTAL_SEP=$(python3 -c "print($TOTAL_SEP + $need)"); else TOTAL_ARC=$(python3 -c "print($TOTAL_ARC + $need)"); fi
    fi
  done <<< "$list"
}
scan_vaults sepolia "$SEPOLIA_RPC" "$USDC_SEPOLIA" "$VAULTS_SEPOLIA"
scan_vaults arc "$ARC_RPC" "$USDC_ARC" "$VAULTS_ARC"

# `|` rather than `:` — an RPC URL is full of colons, and splitting on those read every bot
# balance from the host "https", which looked exactly like a chain that would not answer.
while IFS='|' read -r chain rpc usdc; do
  [ -z "$chain" ] && continue
  while IFS='|' read -r label addr; do
    [ -z "$label" ] && continue
    have=$(read_retry "$rpc" "$usdc" 'balanceOf(address)(uint256)' "$addr")
    if [ "$have" = "READ_FAILED" ]; then plan_line "  ?? $chain $label: could not read, skipping"; continue; fi
    have=$(whole "$have" 6); need=$(short "$TARGET_BOT" "$have")
    if [ "$need" = "0" ]; then plan_line "  ok $chain $label: $have / $TARGET_BOT USDC"
    else
      plan_line "  -> $chain $label: $have / $TARGET_BOT USDC, send $need"
      echo "USDC|$chain|$rpc|$usdc|$addr|$need|$chain $label" >> "$PLAN_FILE.do"
      if [ "$chain" = sepolia ]; then TOTAL_SEP=$(python3 -c "print($TOTAL_SEP + $need)"); else TOTAL_ARC=$(python3 -c "print($TOTAL_ARC + $need)"); fi
    fi
  done <<< "bot #1|$BOT1
bot #2|$BOT2"
done <<< "sepolia|$SEPOLIA_RPC|$USDC_SEPOLIA
arc|$ARC_RPC|$USDC_ARC"

while IFS='|' read -r label addr target; do
  [ -z "$label" ] && continue
  raw=$(eth_of "$addr" "$SEPOLIA_RPC")
  if [ "$raw" = "READ_FAILED" ]; then plan_line "  ?? gas $label: could not read, skipping"; continue; fi
  have=$(whole "$raw" 18); need=$(short "$target" "$have")
  if [ "$need" = "0" ]; then plan_line "  ok gas $label: $have / $target ETH"
  else
    plan_line "  -> gas $label: $have / $target ETH, send $need"
    echo "ETH||||$addr|$need|$label" >> "$PLAN_FILE.do"
    TOTAL_ETH=$(python3 -c "print($TOTAL_ETH + $need)")
  fi
done <<< "$GAS_WALLETS"

echo; echo "from $DEPLOYER"; echo
cat "$PLAN_FILE"
echo
echo "  to send: $(python3 -c "print(f'{$TOTAL_SEP:.2f}')") USDC on Sepolia, $(python3 -c "print(f'{$TOTAL_ARC:.2f}')") USDC on Arc, $(python3 -c "print(f'{$TOTAL_ETH:.4f}')") ETH on Sepolia"
echo "  (targets, so anything already at its level is left alone; safe to rerun)"
echo
echo "  NOT included: Uniswap pool depth — that mints matching mock tokens and moves prices,"
echo "                so it lives in the market repo (~/code/uniswap-v2). Ask before running it."

if [ ! -s "$PLAN_FILE.do" ]; then echo; echo "everything is already at target — nothing to send."; rm -f "$PLAN_FILE" "$PLAN_FILE.do"; exit 0; fi
if [ "$DRY" = "--dry-run" ]; then echo; echo "dry run — nothing sent."; rm -f "$PLAN_FILE" "$PLAN_FILE.do"; exit 0; fi
echo
read -r -p "send these? [y/N] " reply
[ "$reply" = "y" ] || { echo "cancelled."; rm -f "$PLAN_FILE" "$PLAN_FILE.do"; exit 0; }

FAILED=0
while IFS='|' read -r kind chain rpc usdc addr amount label; do
  case "$kind" in
    VAULT) deposit_to "$rpc" "$usdc" "$addr" "$amount" "$label" || FAILED=$((FAILED+1)) ;;
    USDC)  send_usdc "$rpc" "$usdc" "$addr" "$amount" "$label" || FAILED=$((FAILED+1)) ;;
    ETH)   send_eth "$addr" "$amount" "$label" || FAILED=$((FAILED+1)) ;;
  esac
done < "$PLAN_FILE.do"
rm -f "$PLAN_FILE" "$PLAN_FILE.do"

echo
if [ "$FAILED" -gt 0 ]; then echo "$FAILED line(s) failed — rerun this script; it only sends what is still short."; else echo "done."; fi
echo "check with:  pnpm exec tsx scripts/balance-watch.ts --once"
