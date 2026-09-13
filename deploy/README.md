# Running the market around the clock

Six processes have to be up for the market to work and be watched. Four are pure
outbound workers; two are what a visitor's browser talks to and need a public HTTPS name.

| Service | What it does | Public? |
| --- | --- | --- |
| `relay` | Telemetry relay: solvers pair and heartbeat here; the site reads "paired / online / stage" from it | yes — `https://relay.<host>` |
| `house-solver` | The Arcaidia House Vault's solver (Circle Agent Wallet signer) and the `/quote` endpoint the Transfer page shows | yes — `https://quote.<host>` |
| `x402-gateway` | WP-35: the Hedera x402 paywall in front of the relay's `/v1/intelligence/*`; solvers pay it per request | yes — `https://intel.<host>` |
| `settlement` | Completes canonical CCTP settlement with `settleWithProof` for every pending intent (reads the Nest) | no |
| `solver-b`, `solver-c` | The two independent operators (`--profile operators`) | no |
| `loadgen` | Real testnet traffic with organic scarcity (`--profile loadgen`) | no |
| `caddy` | HTTPS in front of the two public ones, certificates fetched automatically | — |

## Building: on your machine, not the box

`BUILD=local scripts/ops-deploy.sh ubuntu@<ip>` builds the one shared service image
(`arcaidia-service`, `deploy/Dockerfile.service`) here for linux/amd64 and streams it to the
box, which only loads it and restarts. This is the recommended path: a t3.small (2 GB) runs
the eight containers at the edge of its memory, and building or unpacking images there means
an hour of swapping and a full disk. Without `BUILD=local` the box builds the image itself.

If the box keeps swapping at idle (`free -m` shows most of the 2 GB used), the fix is a
t3.medium (4 GB). Allocate an Elastic IP and attach it first so the address, and therefore
every `*.<ip>.sslip.io` hostname, survives the stop/start a resize needs.

## One-time

1. Any Ubuntu/Debian box with a public IP (a $5 VPS is plenty). SSH access as a user with sudo.
2. Locally: `.env` filled in (House solver keys, reporter key, Circle wallet), plus
   `.env.solver-b` / `.env.solver-c` / `.env.loadgen` for the profiles you want. For WP-35 the
   `.env` also carries `HEDERA_ACCOUNT_ID` / `HEDERA_PRIVATE_KEY` (the House solver's paying account) and
   `X402_PAY_TO` (a *second* account the gateway is paid into — a self-transfer nets to zero
   and fails verification, so one account cannot play both roles) and
   `INTELLIGENCE_URL=http://x402-gateway:8402` for the House solver.

## Deploy / redeploy

```bash
scripts/ops-deploy.sh ubuntu@<ip>
PROFILES="--profile operators --profile loadgen" scripts/ops-deploy.sh ubuntu@<ip>
```

The script installs Docker if missing, syncs this checkout and the env files, builds the
images on the box and starts everything with `restart: unless-stopped`. It prints the two
public URLs. With no DNS of your own it uses `<ip>.sslip.io`, which resolves anywhere and
gets real certificates; set `OPS_HOST=yourdomain.com` to use your own instead (point
`relay.`, `quote.` and `intel.` at the box).

## Then

- Web build: `VITE_SOLVER_TELEMETRY_URL=https://relay.<host>`,
  `VITE_SOLVER_QUOTE_URL=https://quote.<host>` and `VITE_X402_GATEWAY_URL=https://intel.<host>`. The relay URL is also what `/earn` writes into
  every operator's downloaded env, so new vaults report to the same relay the site reads.
- Logs: `ssh ubuntu@<ip> 'cd arcaidia && docker compose -f docker-compose.ops.yml logs -f settlement'`.
