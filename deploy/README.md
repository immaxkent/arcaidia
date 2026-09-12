# Running the market around the clock

Five processes have to be up for the market to work and be watched. Four are pure
outbound workers; two are what a visitor's browser talks to and need a public HTTPS name.

| Service | What it does | Public? |
| --- | --- | --- |
| `relay` | Telemetry relay: solvers pair and heartbeat here; the site reads "paired / online / stage" from it | yes — `https://relay.<host>` |
| `house-solver` | The Arcaidia House Vault's solver (Circle Agent Wallet signer) and the `/quote` endpoint the Transfer page shows | yes — `https://quote.<host>` |
| `settlement` | Completes canonical CCTP settlement with `settleWithProof` for every pending intent (reads the Nest) | no |
| `solver-b`, `solver-c` | The two independent operators (`--profile operators`) | no |
| `loadgen` | Real testnet traffic with organic scarcity (`--profile loadgen`) | no |
| `caddy` | HTTPS in front of the two public ones, certificates fetched automatically | — |

## One-time

1. Any Ubuntu/Debian box with a public IP (a $5 VPS is plenty). SSH access as a user with sudo.
2. Locally: `.env` filled in (House solver keys, reporter key, Circle wallet), plus
   `.env.solver-b` / `.env.solver-c` / `.env.loadgen` for the profiles you want.

## Deploy / redeploy

```bash
scripts/ops-deploy.sh ubuntu@<ip>
PROFILES="--profile operators --profile loadgen" scripts/ops-deploy.sh ubuntu@<ip>
```

The script installs Docker if missing, syncs this checkout and the env files, builds the
images on the box and starts everything with `restart: unless-stopped`. It prints the two
public URLs. With no DNS of your own it uses `<ip>.sslip.io`, which resolves anywhere and
gets real certificates; set `OPS_HOST=yourdomain.com` to use your own instead (point
`relay.` and `quote.` at the box).

## Then

- Web build: `VITE_SOLVER_TELEMETRY_URL=https://relay.<host>` and
  `VITE_SOLVER_QUOTE_URL=https://quote.<host>`. The relay URL is also what `/earn` writes into
  every operator's downloaded env, so new vaults report to the same relay the site reads.
- Logs: `ssh ubuntu@<ip> 'cd arcaidia && docker compose -f docker-compose.ops.yml logs -f settlement'`.
