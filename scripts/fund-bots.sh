#!/usr/bin/env bash
# Top up whichever wallets the balance watcher says are low or critical, from the deployer
# keystore (`deployKey`). One password prompt per transfer.
#
#   scripts/fund-bots.sh              # show the plan, ask, then send
#   scripts/fund-bots.sh --dry-run    # show the plan and stop
#   scripts/fund-bots.sh --yes        # no confirmation (for a rerun you already eyeballed)
#
# What to send is decided by scripts/bot-balances.ts, not here, so the thresholds and the
# refill amounts have exactly one definition. This script only signs and broadcasts.
#
# Wallets whose balance could not be read are never funded — a rate-limited RPC read must
# not turn into a second transfer to a wallet that was fine.
set -euo pipefail
cd "$(dirname "$0")/.."

DEPLOYER=0x538e5E9797fa86eE25e97289439b6A3AbA0165b0
env_value() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' ; }
SEPOLIA_RPC=${SEPOLIA_RPC:-$(env_value ETHEREUM_SEPOLIA_RPC_URL)}
SEPOLIA_RPC=${SEPOLIA_RPC:-https://ethereum-sepolia-rpc.publicnode.com}
ARC_RPC=${ARC_RPC:-$(env_value ARC_TESTNET_RPC_URL)}
ARC_RPC=${ARC_RPC:-https://rpc.testnet.arc.network}

dry_run=false
assume_yes=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=true;;
    --yes|-y)  assume_yes=true;;
    *) echo "unknown argument: $arg" >&2; exit 2;;
  esac
done

# Overridable so the plan rendering can be exercised against a fixture without touching a chain.
PLAN_CMD=${PLAN_CMD:-"npx tsx scripts/balance-watch.ts --json"}

echo "reading balances..."
plan=$($PLAN_CMD)
count=$(printf '%s' "$plan" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))")

if [ "$count" -eq 0 ]; then
  echo "Nothing to fund — every wallet is above its low mark."
  exit 0
fi

echo
echo "top-ups to send from $DEPLOYER:"
printf '%s' "$plan" | python3 -c "
import json, sys
for line in json.load(sys.stdin):
    print(f\"  {line['status']:8} {line['label']:22} {line['chain']:16} {line['amount']:>8} {line['asset']}   (has {line['balance']})\")
"
echo

if [ "$dry_run" = true ]; then
  echo "dry run — nothing sent."
  exit 0
fi

if [ "$assume_yes" != true ]; then
  read -r -p "send these $count transfer(s)? [y/N] " reply
  case "$reply" in [yY]*) ;; *) echo "cancelled."; exit 0;; esac
fi

# One line per transfer: chain, address, amount, and either "native" or the token address.
printf '%s' "$plan" | python3 -c "
import json, sys
for line in json.load(sys.stdin):
    read = line['read']
    target = 'native' if read['kind'] == 'native' else read['token']
    print(line['chain'], line['address'], line['amount'], line['decimals'], target, line['label'].replace(' ', '_'))
" | while read -r chain address amount decimals target who; do
  case "$chain" in
    ethereum-sepolia) rpc=$SEPOLIA_RPC;;
    arc-testnet)      rpc=$ARC_RPC;;
    *) echo "unknown chain $chain" >&2; exit 1;;
  esac

  echo "== ${who//_/ } — $amount on $chain to $address"
  if [ "$target" = native ]; then
    cast send "$address" --value "${amount}ether" --rpc-url "$rpc" --account deployKey -f "$DEPLOYER" \
      | grep -E "^(status|transactionHash)"
  else
    units=$(python3 -c "from decimal import Decimal; print(int(Decimal('$amount') * 10**$decimals))")
    cast send "$target" "transfer(address,uint256)" "$address" "$units" --rpc-url "$rpc" --account deployKey -f "$DEPLOYER" \
      | grep -E "^(status|transactionHash)"
  fi
done

echo
echo "done. re-reading balances:"
npx tsx scripts/balance-watch.ts --once
