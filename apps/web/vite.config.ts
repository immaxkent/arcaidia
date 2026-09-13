// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

/** The npm `buffer` package's entry, by absolute path — what the browser build gets for `buffer`. */
const bufferForBrowser = fileURLToPath(import.meta.resolve("buffer/index.js"));
/** `vite build` vs `vite dev`: the browser Buffer mapping differs (see below). */
const isBuild = process.argv.includes("build");

const bufferInTheBrowser: Plugin = {
  name: "arcaidia:buffer-in-the-browser",
  enforce: "pre",
  applyToEnvironment: (env) => env.name === "client",
  resolveId(id) {
    return id === "buffer" || id === "node:buffer" ? bufferForBrowser : null;
  },
};

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
    // In a build the client-only resolver hands the bundler the package's entry file directly
    // (a bare `buffer/` re-entering the resolver crashed the bundler). In dev that file would be
    // served raw — CommonJS in the browser, "require is not defined" — so dev instead aliases to
    // the bare package and lets the dependency optimizer prebundle it. The alias is dev-only
    // because it would also reach the server bundle in a build.
    ...(isBuild
      ? {
          plugins: [bufferInTheBrowser],
        }
      : {
          resolve: { alias: [{ find: /^(node:)?buffer$/, replacement: "buffer/" }] },
          optimizeDeps: { include: ["buffer/"] },
        }),
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
