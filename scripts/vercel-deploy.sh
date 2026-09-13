#!/usr/bin/env bash
# Deploy the site to Vercel from this machine: build with the Vercel preset here, upload only the
# build output as one archive. Vercel's own remote build of this monorepo failed on upload, and a
# prebuilt deploy is faster and reproducible anyway. Needs `vercel login` and `vercel link` once
# (deploy/VERCEL.md).
#
#   scripts/vercel-deploy.sh            # production
#   scripts/vercel-deploy.sh preview    # a preview deployment
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT/apps/web"
[ -d .vercel ] || { echo "run 'vercel link' in apps/web first"; exit 1; }
rm -rf .vercel/output
NITRO_PRESET=vercel pnpm exec vite build
if [ "${1:-production}" = "production" ]; then
  vercel deploy --prebuilt --prod --yes --archive=tgz
else
  vercel deploy --prebuilt --yes --archive=tgz
fi
