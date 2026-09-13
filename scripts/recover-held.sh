#!/usr/bin/env bash
# D12 follow-up: settlements the old receiver parked as HELD_FOR_VAULT because the winning vault
# had already been re-pointed at the v2.1 receiver (recordReimbursement is receiver-only). For a
# vault the deploy key owns (the House Vault): point it back at the old receiver, retryHeld each
# parked intent (permissionless), point it at the current receiver again. Independent operators
# do the same from the console's owner controls.
#
#   scripts/recover-held.sh                  # plan
#   RECOVER=1 scripts/recover-held.sh        # run (deployKey prompts)
set -euo pipefail
OLD=0x8B93b54d6Df61E9422D14C309F3c9Ab950b920Cd
NEW=0xa60c586E4d050233885cD6628B7C1A217574d9c6
HOUSE=0xB4bA190D5C78869366e7963f5CcCf4c3167d855C
DEPLOYER=0x538e5E9797fa86eE25e97289439b6A3AbA0165b0
NEST=https://hackathon.89.167.109.4.sslip.io
rpc()  { case "$1" in 11155111) echo https://ethereum-sepolia-rpc.publicnode.com ;; 5042002) echo https://arc-testnet.drpc.org ;; esac; }
nest() { case "$1" in 11155111) echo arcaidia-sepolia ;; 5042002) echo arcaidia-arc ;; esac; }
for chain in 11155111 5042002; do
  Q=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "SELECT intent_id FROM settlements WHERE outcome = 'HELD_FOR_VAULT' AND held_for_vault = '$(echo $HOUSE | tr A-Z a-z)'")
  ids=$(curl -s -m 20 "$NEST/$(nest $chain)/sql?q=$Q" | python3 -c "import sys,json; print(' '.join(r['intent_id'] for r in json.load(sys.stdin).get('rows',[])))")
  [ -z "$ids" ] && { echo "chain $chain: nothing held for the House Vault"; continue; }
  echo "chain $chain: House Vault has $(echo $ids | wc -w | tr -d ' ') held reimbursement(s)"
  if [ "${RECOVER:-0}" != "1" ]; then echo "  RECOVER=1 to release: setSettlementReceiver(old) → retryHeld × n → setSettlementReceiver(new)"; continue; fi
  cast send $HOUSE "setSettlementReceiver(address)" $OLD --rpc-url $(rpc $chain) --account deployKey -f $DEPLOYER | grep -E "status"
  for id in $ids; do echo "  retryHeld $id"; cast send $OLD "retryHeld(bytes32)" $id --rpc-url $(rpc $chain) --account deployKey -f $DEPLOYER | grep -E "status"; done
  cast send $HOUSE "setSettlementReceiver(address)" $NEW --rpc-url $(rpc $chain) --account deployKey -f $DEPLOYER | grep -E "status"
  echo "  House Vault exposure now: $(cast call $HOUSE 'outstandingExposure()(uint256)' --rpc-url $(rpc $chain) | awk '{print $1/1e6}')"
done
