# WP-17 — Reference solver runtime + telemetry sidecar (M17)

**Objective:** package the solver loop that already exists (WP-05/06/08/09) as a distributable,
unattended runtime any vault owner can point at their own vault — and prove telemetry can vanish
entirely without stopping a single fill.

**Depends on:** WP-16. **Blocks:** WP-18, WP-19. **Stack:** Docker Compose,
`packages/agent`, a new `packages/telemetry`.

## Sub-tasks

- [ ] **17.1 `arcaidia-solver` container.** Same `processIntent` / `ObservationProvider` /
      `SettlementAdapter` / `AgentAuthority` code that runs today — no new decision logic — made
      parametric on `VAULT_ADDRESS` via env config rather than a compiled-in constant. One image,
      any vault.
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

- `arcaidia-solver` against two different `VAULT_ADDRESS` values in the same test run produces
  correctly independent behaviour (no shared state leaking between "instances").
- Telemetry sidecar: a forwarded event's HTTP call failing or timing out never blocks or delays
  the solver's own decision/submission path.
- Kill-the-Relay: full golden-run-equivalent lifecycle, Relay never started, solver completes
  every fill exactly as WP-07's golden run does.

## Acceptance gate

Two solver containers, pointed at two different vaults, both running against the same market, one
with telemetry entirely disabled — all still fill correctly. This is the gate; the frontend (WP-19)
has nothing to show until this exists.
