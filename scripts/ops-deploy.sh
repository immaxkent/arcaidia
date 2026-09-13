#!/usr/bin/env bash
# Push the operations stack to a box and (re)start it there. One command, idempotent:
#
#   scripts/ops-deploy.sh ubuntu@203.0.113.7                # relay + House solver + worker
#   SSH_KEY=~/.ssh/my-aws-key.pem scripts/ops-deploy.sh ubuntu@203.0.113.7
#   PROFILES="--profile operators --profile loadgen" scripts/ops-deploy.sh ubuntu@203.0.113.7
#
# Needs: ssh access to an Ubuntu/Debian box with Docker (installed on first run if missing),
# and the env files present locally: .env, and .env.solver-b / .env.solver-c / .env.loadgen for
# the profiles you enable. Nothing else — images are built on the box from this checkout.
set -euo pipefail
HOST=${1:?usage: scripts/ops-deploy.sh user@host}
REMOTE_DIR=${REMOTE_DIR:-arcaidia}
# SSH_KEY=~/.ssh/my-instance.pem for an AWS key pair; unset = your default ssh identity.
SSH_OPTS=${SSH_KEY:+-i $SSH_KEY}
ssh() { command ssh $SSH_OPTS -o StrictHostKeyChecking=accept-new "$@"; }
rsync() { command rsync -e "ssh $SSH_OPTS -o StrictHostKeyChecking=accept-new" "$@"; }
PROFILES=${PROFILES:-}
ROOT=$(cd "$(dirname "$0")/.." && pwd)

# The public hostname Caddy serves: your own (OPS_HOST=relay.example.com's parent) or the
# box's IP through sslip.io, which needs no DNS at all.
IP=$(ssh "$HOST" 'curl -s https://api.ipify.org')
OPS_HOST=${OPS_HOST:-"$IP.sslip.io"}
echo "== deploying to $HOST as https://relay.$OPS_HOST, https://quote.$OPS_HOST and https://intel.$OPS_HOST"

ssh "$HOST" 'command -v docker >/dev/null || (curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker "$USER")'
# A 2 GB box builds the images only with some swap behind it; idempotent.
ssh "$HOST" 'test -f /swapfile || (sudo fallocate -l 3G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile && echo "/swapfile none swap sw 0 0" | sudo tee -a /etc/fstab >/dev/null)'

rsync -az --delete \
  --exclude node_modules --exclude .git --exclude 'apps/web/dist' --exclude 'contracts/out' --exclude 'contracts/cache' \
  --exclude 'subgraph/build*' --exclude '.claude' --exclude '*.jsonl' \
  "$ROOT/" "$HOST:$REMOTE_DIR/"

for f in .env .env.solver-b .env.solver-c .env.loadgen; do
  [ -f "$ROOT/$f" ] && rsync -az "$ROOT/$f" "$HOST:$REMOTE_DIR/$f"
done

# sudo drops the environment, so OPS_HOST rides along explicitly when compose needs root.
# Build one image at a time: seven parallel builds on a 2 GB box swap for an hour and starve sshd.
ssh "$HOST" "cd $REMOTE_DIR && DC='env OPS_HOST=$OPS_HOST COMPOSE_BAKE=false COMPOSE_PARALLEL_LIMIT=1 docker compose'; docker info >/dev/null 2>&1 || DC='sudo env OPS_HOST=$OPS_HOST COMPOSE_BAKE=false COMPOSE_PARALLEL_LIMIT=1 docker compose'; \$DC -f docker-compose.ops.yml $PROFILES up -d --build --remove-orphans && \$DC -f docker-compose.ops.yml ps"
echo "== relay:  https://relay.$OPS_HOST/health"
echo "== quote:  https://quote.$OPS_HOST/quote"
echo "== intel:  https://intel.$OPS_HOST/v1/pricing  (WP-35 — 402 on /v1/intelligence/*)"
echo "Set VITE_SOLVER_TELEMETRY_URL=https://relay.$OPS_HOST, VITE_SOLVER_QUOTE_URL=https://quote.$OPS_HOST and VITE_X402_GATEWAY_URL=https://intel.$OPS_HOST for the web build,"
echo "and ARCAIDIA_TELEMETRY_URL=https://relay.$OPS_HOST in every operator's downloaded env."
