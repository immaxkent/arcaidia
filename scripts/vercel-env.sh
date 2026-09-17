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
  [ -n "${value%$'\r'}" ] || { echo "skip $key (empty: the app's committed default applies)"; continue; }
  value=${value%$'\r'}
  vercel env rm "$key" "$ENVIRONMENT" --yes </dev/null >/dev/null 2>&1 || true
  if printf '%s' "$value" | vercel env add "$key" "$ENVIRONMENT" >/dev/null 2>&1; then echo "set $key"; else echo "FAILED $key"; fi
done < <(grep -E '^VITE_[A-Z0-9_]+=' .env)
vercel env rm NITRO_PRESET "$ENVIRONMENT" --yes </dev/null >/dev/null 2>&1 || true
printf '%s' "vercel" | vercel env add NITRO_PRESET "$ENVIRONMENT" >/dev/null 2>&1 || echo "FAILED NITRO_PRESET"
echo "set NITRO_PRESET=vercel"
