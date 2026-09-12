#!/usr/bin/env bash
# D12 recovery: intents burned before the v2.1 receiver landed can never be received by the v2.0
# receiver (it named itself destinationCaller, then refused every message). The vaults that
# fast-filled them are made whole through the v2.0 receiver's reporter path instead:
#   1. someone sends the total canonical USDC to the OLD receiver on each destination chain;
#   2. an allowed reporter calls settle(intentId, recipient, amount) per intent — the receiver
#      pays the market's winner (LP_REIMBURSED) or the recipient if nobody filled.
#
#   scripts/recover-stuck-settlements.sh            # plan: totals + the exact commands, sends nothing
#   RECOVER=1 scripts/recover-stuck-settlements.sh  # after funding: run the settle calls (deployKey prompts)
set -euo pipefail
OLD_RECEIVER=0x8B93b54d6Df61E9422D14C309F3c9Ab950b920Cd
NEW_RECEIVER=0xa60c586E4d050233885cD6628B7C1A217574d9c6
DEPLOYER=0x538e5E9797fa86eE25e97289439b6A3AbA0165b0
NEST=https://hackathon.89.167.109.4.sslip.io
# macOS ships bash 3: no associative arrays, so per-chain constants are functions.
rpc()  { case "$1" in 11155111) echo https://ethereum-sepolia-rpc.publicnode.com ;; 5042002) echo https://arc-testnet.drpc.org ;; esac; }
usdc() { case "$1" in 11155111) echo 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 ;; 5042002) echo 0x3600000000000000000000000000000000000000 ;; esac; }

plan=$(python3 - <<'PY'
import json, urllib.parse, urllib.request
NEST="https://hackathon.89.167.109.4.sslip.io"
P={11155111:"arcaidia-sepolia",5042002:"arcaidia-arc"}
OLD="0x8b93b54d6df61e9422d14c309f3c9ab950b920cd"
def q(chain,sql):
    with urllib.request.urlopen(f"{NEST}/{P[chain]}/sql?q={urllib.parse.quote(sql)}",timeout=20) as r: return json.load(r)["rows"]
out=[]
for dest,src in ((5042002,11155111),(11155111,5042002)):
    # every intent created on src before the fix, whose canonical leg targets the OLD receiver: all of them so far
    intents=q(src,"SELECT id, recipient, amount, created_at_timestamp FROM intents WHERE canonical_status = 'PENDING' ORDER BY created_at_timestamp ASC")
    if not intents: continue
    ids=",".join("'"+i["id"].lower()+"'" for i in intents)
    settled={s["intent_id"].lower() for s in q(dest,f"SELECT intent_id FROM settlements WHERE intent_id IN ({ids})")}
    total=0
    for i in intents:
        if i["id"].lower() in settled: continue
        total+=int(i["amount"])
        out.append((dest,i["id"],i["recipient"],int(i["amount"])))
    print(f"# destination {dest}: {len([o for o in out if o[0]==dest])} intents, {total/1e6:.6f} USDC to send to {OLD}")
for dest,iid,rcpt,amt in out:
    print(f"{dest} {iid} {rcpt} {amt}")
PY
)
echo "$plan" | grep '^#'
echo
echo "== step 1: fund the OLD receiver on each destination chain (from any wallet holding USDC):"
for c in 5042002 11155111; do
  total=$(echo "$plan" | awk -v c=$c '$1==c {s+=$4} END {print s+0}')
  [ "$total" = "0" ] && continue
  echo "cast send $(usdc $c) \"transfer(address,uint256)\" $OLD_RECEIVER $total --rpc-url $(rpc $c) --account deployKey -f $DEPLOYER   # chain $c: $(python3 -c "print($total/1e6)") USDC"
done
echo
if [ "${RECOVER:-0}" != "1" ]; then
  echo "== step 2 (dry): RECOVER=1 $0 runs settle(intentId, recipient, amount) for each line below with deployKey (the allowed reporter):"
  echo "$plan" | grep -v '^#'
  exit 0
fi
echo "== step 2: settling"
echo "$plan" | grep -v '^#' | while read -r chain iid rcpt amt; do
  held=$(cast call $(usdc $chain) "balanceOf(address)(uint256)" $OLD_RECEIVER --rpc-url $(rpc $chain) | awk '{print $1}')
  if [ "$held" -lt "$amt" ]; then echo "-- chain $chain: receiver holds $held < $amt for $iid — fund it first"; continue; fi
  echo "-- chain $chain settle $iid ($amt)"
  cast send $OLD_RECEIVER "settle(bytes32,address,uint256)" $iid $rcpt $amt --rpc-url $(rpc $chain) --account deployKey -f $DEPLOYER | grep -E "status|transactionHash"
done
