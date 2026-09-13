#!/usr/bin/env bash
# Push the web app's VITE_* variables from apps/web/.env into the linked Vercel project, for the
# production environment. Run after `vercel login` and `vercel link` (from apps/web). Idempotent:
# an existing variable is removed and re-added. Values are the same public ones the browser
# receives; nothing here is a secret.
#
#   scripts/vercel-env.sh              # production
#   scripts/vercel-env.sh preview      # another environment
set -euo pipefail
ENVIRONMENT=${1:-production}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT/apps/web"
[ -f .env ] || { echo "apps/web/.env not found"; exit 1; }
[ -d .vercel ] || { echo "run 'vercel link' in apps/web first"; exit 1; }
while IFS='=' read -r key value; do
  case "$key" in VITE_*) ;; *) continue ;; esac
  value=${value%$'\r'}
  vercel env rm "$key" "$ENVIRONMENT" --yes >/dev/null 2>&1 || true
  printf '%s' "$value" | vercel env add "$key" "$ENVIRONMENT" >/dev/null
  echo "set $key"
done < <(grep -E '^VITE_[A-Z0-9_]+=' .env)
printf '%s' "vercel" | vercel env add NITRO_PRESET "$ENVIRONMENT" >/dev/null 2>&1 || true
echo "set NITRO_PRESET=vercel"
