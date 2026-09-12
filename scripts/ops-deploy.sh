#!/usr/bin/env bash
# Push the operations stack to a box and (re)start it there. One command, idempotent:
#
#   scripts/ops-deploy.sh ubuntu@203.0.113.7                # relay + House solver + worker
#   PROFILES="--profile operators --profile loadgen" scripts/ops-deploy.sh ubuntu@203.0.113.7
#
# Needs: ssh access to an Ubuntu/Debian box with Docker (installed on first run if missing),
# and the env files present locally: .env, and .env.solver-b / .env.solver-c / .env.loadgen for
# the profiles you enable. Nothing else — images are built on the box from this checkout.
set -euo pipefail
HOST=${1:?usage: scripts/ops-deploy.sh user@host}
REMOTE_DIR=${REMOTE_DIR:-arcaidia}
PROFILES=${PROFILES:-}
ROOT=$(cd "$(dirname "$0")/.." && pwd)

# The public hostname Caddy serves: your own (OPS_HOST=relay.example.com's parent) or the
# box's IP through sslip.io, which needs no DNS at all.
IP=$(ssh "$HOST" 'curl -s https://api.ipify.org')
OPS_HOST=${OPS_HOST:-"$IP.sslip.io"}
echo "== deploying to $HOST as https://relay.$OPS_HOST and https://quote.$OPS_HOST"

ssh "$HOST" 'command -v docker >/dev/null || (curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker "$USER")'

rsync -az --delete \
  --exclude node_modules --exclude .git --exclude 'apps/web/dist' --exclude 'contracts/out' --exclude 'contracts/cache' \
  --exclude 'subgraph/build*' --exclude '.claude' --exclude '*.jsonl' \
  "$ROOT/" "$HOST:$REMOTE_DIR/"

for f in .env .env.solver-b .env.solver-c .env.loadgen; do
  [ -f "$ROOT/$f" ] && rsync -az "$ROOT/$f" "$HOST:$REMOTE_DIR/$f"
done

ssh "$HOST" "cd $REMOTE_DIR && OPS_HOST=$OPS_HOST docker compose -f docker-compose.ops.yml $PROFILES up -d --build --remove-orphans && docker compose -f docker-compose.ops.yml ps"
echo "== relay:  https://relay.$OPS_HOST/health"
echo "== quote:  https://quote.$OPS_HOST/quote"
echo "Set VITE_SOLVER_TELEMETRY_URL=https://relay.$OPS_HOST and VITE_SOLVER_QUOTE_URL=https://quote.$OPS_HOST for the web build,"
echo "and ARCAIDIA_TELEMETRY_URL=https://relay.$OPS_HOST in every operator's downloaded env."
