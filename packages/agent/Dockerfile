# arcaidia-solver — the reference solver runtime (WP-17.1/17.3).
#
# Build from the repo root, not this directory: pnpm workspaces need the whole
# workspace tree to resolve `workspace:*` deps correctly.
#
#   docker build -f packages/agent/Dockerfile -t arcaidia-solver .
#
# No compile step: this ships TypeScript source and runs it with tsx, exactly
# as `pnpm solver:start` already does locally — the same code path, not a
# separate build artifact that could drift from what's actually tested.
#
# Runtime config is entirely environment variables (VAULT_ADDRESS overrides,
# TELEMETRY_ENABLED, signer keys, ...) — see .env.example and
# WP-INTENT-MARKET.md §7. Never bakes a .env file into the image.
FROM node:22-slim

# Deliberately not `corepack enable`: corepack's shim fetches pnpm into a
# *per-user* cache the first time it runs, so `corepack prepare` here (as
# root, during build) doesn't help the `solver` user's own first run below —
# confirmed by testing this image with --network none and watching corepack
# try to hit the npm registry anyway. Installing pnpm as a real global binary
# sidesteps that per-user-cache behaviour entirely.
RUN npm install -g pnpm@10.2.0

WORKDIR /app

# Install first, from only the files that affect dependency resolution, so
# an unrelated source change doesn't invalidate this layer's cache.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/agent/package.json packages/agent/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/telemetry/package.json packages/telemetry/package.json
COPY packages/settlement/package.json packages/settlement/package.json
COPY packages/mcp/package.json packages/mcp/package.json
COPY packages/relay/package.json packages/relay/package.json
COPY packages/loadgen/package.json packages/loadgen/package.json
COPY apps/web/package.json apps/web/package.json
COPY tests/e2e/package.json tests/e2e/package.json

RUN pnpm install --frozen-lockfile

# Now the source this image actually runs.
COPY packages/agent packages/agent
COPY packages/domain packages/domain
COPY packages/telemetry packages/telemetry

# Runs as an unprivileged user — this process only ever makes outbound calls
# (RPC, The Graph, the Relay); nothing here needs root.
RUN useradd --create-home --shell /bin/false solver
USER solver

ENTRYPOINT ["pnpm", "exec", "tsx", "packages/agent/src/entrypoint/main.ts"]
