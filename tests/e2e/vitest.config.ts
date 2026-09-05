import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Two anvil instances plus a full deployment. Generous, but the suite is
    // deterministic: if it hits these it has hung, not run slowly.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // The two chains are shared mutable state; running files in parallel would
    // make failures depend on scheduling.
    fileParallelism: false,
  },
});
