# The site on Vercel — arcaidia.io

The web app (`apps/web`, TanStack Start on Nitro) builds for Vercel's Build Output API when
`NITRO_PRESET=vercel`; `apps/web/vercel.json` carries the monorepo install/build commands.
Everything the site needs at runtime is a public `VITE_*` value (RPC endpoints, contract
addresses, the box's hostnames, the Privy app id) — no secrets, no server-side keys.

## One-time

1. **Log in and link** (needs your Vercel account; a browser window opens):
   ```bash
   cd apps/web && vercel login && vercel link
   ```
   Create a new project when asked (name `arcaidia`), root directory `apps/web`.
2. **Env vars** — pushes every `VITE_*` line of `apps/web/.env` plus `NITRO_PRESET=vercel`:
   ```bash
   scripts/vercel-env.sh
   ```
   The values that matter for production: `VITE_SOLVER_TELEMETRY_URL`, `VITE_SOLVER_QUOTE_URL`,
   `VITE_X402_GATEWAY_URL`, `VITE_MARKET_PRICE_URL` (the four `*.<ip>.sslip.io` hosts of the
   ops box), `VITE_TRADE_INTENTS_ENABLED=true`, the two RPC URLs, and `VITE_PRIVY_APP_ID`.
3. **Deploy**:
   ```bash
   cd apps/web && vercel --prod
   ```
   Later deploys: pushes to `main` deploy automatically once the Git integration is connected
   in the Vercel dashboard (Project → Settings → Git, repository `immaxkent/arcaidia`, root
   directory `apps/web`).
4. **Domain**: Vercel project → Settings → Domains → add `arcaidia.io` and `www.arcaidia.io`.
   At the registrar: `A @ 76.76.21.21` and `CNAME www cname.vercel-dns.com` (Vercel shows the
   exact records). Certificates are automatic.
5. **Privy**: dashboard → the app → Allowed origins: add `https://arcaidia.io` and
   `https://www.arcaidia.io`, or wallet login on the live site is refused.

## What talks to what

Browser → `arcaidia.io` (Vercel: static assets + the SSR function) → the box over HTTPS:
`relay.` (telemetry, intelligence), `quote.` (House solver quote), `intel.` (x402 gateway),
`prices.` (market price API); all four are CORS-open. Chain reads go straight to the RPCs.
Nothing on Vercel holds a key; every write is signed in the user's own wallet.

If the box's IP changes (see `deploy/README.md`), update the four `VITE_*_URL` values and
redeploy: `scripts/vercel-env.sh && (cd apps/web && vercel --prod)`.
