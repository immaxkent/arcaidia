// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { fileURLToPath } from "node:url";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

/** The npm `buffer` package's entry, by absolute path — what the browser build gets for `buffer`. */
const bufferForBrowser = fileURLToPath(import.meta.resolve("buffer/index.js"));

export default defineConfig({
  // Deploy target. Unset = the wrapper's default (cloudflare-module); Vercel sets
  // NITRO_PRESET=vercel (deploy/VERCEL.md) and gets the Build Output API layout.
  ...(process.env["NITRO_PRESET"] ? { nitro: { preset: process.env["NITRO_PRESET"] } } : {}),
  vite: {
    // WP-35: the Hedera SDK's browser build imports `buffer` and reads the Buffer global when it
    // signs a transfer. In the CLIENT build only, `buffer` is the npm package (the global is set
    // by src/lib/arcaidia/x402-pay.ts before the SDK loads). The server bundle must keep Node's
    // builtin: a shim there lacks buffer.constants, and every server render 500'd on Vercel —
    // which is exactly what vite-plugin-node-polyfills did despite an environment guard.
    plugins: [
      {
        name: "arcaidia:buffer-in-the-browser",
        enforce: "pre",
        applyToEnvironment: (env) => env.name === "client",
        resolveId(id) {
          return id === "buffer" || id === "node:buffer" ? bufferForBrowser : null;
        },
      },
    ],
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
