import { defineConfig } from 'vitest/config';

/**
 * Live-chain checks. Separate from the default config on purpose: `test:global`
 * must stay hermetic and offline, so these never run as part of it.
 *
 * Run them deliberately — before a deployment, or when a chain's tooling
 * changes underneath us — with `pnpm test:chains`.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.live.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
