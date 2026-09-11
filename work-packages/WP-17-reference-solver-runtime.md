# WP-17 — Reference solver runtime + telemetry sidecar (M17)

**Objective:** package the solver loop that already exists (WP-05/06/08/09) as a distributable,
unattended runtime any vault owner can point at their own vault — and prove telemetry can vanish
entirely without stopping a single fill.

**Depends on:** WP-16. **Blocks:** WP-18, WP-19. **Stack:** Docker Compose,
`packages/agent`, a new `packages/telemetry`.

## Sub-tasks

- [x] **17.1 Vault address is genuinely per-instance config now.** Found while starting this WP:
      `packages/agent/src/entrypoint/config.ts` read `liquidityVault` exclusively from
      `packages/domain/src/config/deployments.ts` — the committed House Vault address, with no way
      for a third-party operator to point the same container at their own vault. That was the
      actual gap "parametric on `VAULT_ADDRESS`" needed to close, not a packaging concern.
      `{PREFIX}_LIQUIDITY_VAULT` (e.g. `ETHEREUM_SEPOLIA_LIQUIDITY_VAULT`) now overrides per chain,
      same override-with-fallback shape already used for `{PREFIX}_RPC_URL` — unset, the House
      Solver gets the committed default unchanged; malformed-but-present still fails loudly
      (`ConfigError`), never silently ignored. Container packaging itself (a Dockerfile for
      `arcaidia-solver`) is still open — tracked below, no longer blocked on this.
- [ ] **17.2 `arcaidia-telemetry` sidecar.** New, separate package. Forwards lifecycle events
      (`tx_submitted`, `fill_won`, `fill_lost`, ...) and a heartbeat to the Relay (WP-18) over
      outbound HTTPS only — no inbound port, no custody, cannot move funds by construction.
      Authenticates by signing a challenge with the solver's own operator key.
- [ ] **17.3 Docker Compose reference stack.** `docker-compose.yml` wiring `arcaidia-solver` +
      `arcaidia-telemetry` together, `TELEMETRY_ENABLED=true` default, `.env.example` listing every
      variable from `WP-INTENT-MARKET.md` §7's reference config block.
- [ ] **17.4 Kill-the-Relay test.** The full discover/verify/decide/fill/reimburse cycle passes
      unmodified with `TELEMETRY_ENABLED=false` and the Relay unreachable — this is the load-bearing
      proof that telemetry is observation, never authorisation, the same rule WP-08 already holds
      for The Graph.

## Tests

- [x] Config-layer proof, `test/entrypoint/config.test.ts`: two `loadSolverConfig` calls with
      different vault overrides stay fully independent, an override on one chain doesn't leak to
      the other, and a malformed override fails loudly rather than falling back silently.
- [ ] Container-level version of the same claim, once 17.1's Dockerfile exists: two actual
      `arcaidia-solver` containers, two `VAULT_ADDRESS` values, no shared state.
- Telemetry sidecar: a forwarded event's HTTP call failing or timing out never blocks or delays
  the solver's own decision/submission path.
- Kill-the-Relay: full golden-run-equivalent lifecycle, Relay never started, solver completes
  every fill exactly as WP-07's golden run does.

## Acceptance gate

Two solver containers, pointed at two different vaults, both running against the same market, one
with telemetry entirely disabled — all still fill correctly. This is the gate; the frontend (WP-19)
has nothing to show until this exists.
