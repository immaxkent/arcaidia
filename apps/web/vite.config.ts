// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  vite: {
    // WP-35: the Hedera SDK (behind @x402/hedera) imports `node:buffer` and reads the `Buffer`
    // global when it signs a transfer in the browser. Polyfill exactly that, nothing else.
    // Only the import mapping — no global injection, which would reach every workspace package
    // (including the SSR pass) where the shim cannot be resolved. The global itself is set at
    // runtime by ensureBuffer() in src/lib/arcaidia/x402-pay.ts before the SDK loads.
    plugins: [nodePolyfills({ include: ["buffer"], globals: { Buffer: false, global: false, process: false } })],
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
