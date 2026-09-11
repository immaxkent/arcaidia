# WP-20 — House Vault migration + phase acceptance gate (M20)

**Objective:** the House Vault stops being special-cased and goes through the identical
permissionless path every other participant does — the phase isn't done until Arcaidia's own
solver proves it, not just third parties in a test.

**Depends on:** WP-15–19, all of them. **Blocks:** nothing — this is the phase's final gate.
**Stack:** deploy scripts, `.env`, the live solver process.

## Sub-tasks

- [ ] **20.1 Migrate the House Vault onto the market.** `setAuthorisedSigner` (WP-02, unchanged)
      already does what's needed; this is wiring the existing House Solver/vault pair through
      `ArcaidiaIntentMarket` like any independent deployment, not a new primitive.
- [ ] **20.2 Second, independent vault + solver, stood up for real** — not a mock — to prove the
      market genuinely has more than one participant: its own deployment, its own funding, its own
      operator key, authorised by its own owner call.
- [ ] **20.3 Kill-the-Relay test, for real this time.** Repeat WP-17.4's gate with both the House
      Solver and the independent one live simultaneously, Relay killed mid-run: every in-flight
      fill still completes and reimburses correctly.
- [ ] **20.4 No-approval audit.** Walk the independent participant's whole path
      (deploy → fund → authorise own operator → `docker compose up -d` → `SOLVER AUTHORISED`) and
      confirm no step anywhere required an Arcaidia-controlled key, allowlist entry, or approval.

## Acceptance gate (phase-closing)

Two vaults — House and one genuinely independent deployment — compete live through
`ArcaidiaIntentMarket` for real intents, both fill correctly, both reimburse correctly, and the
whole cycle survives the Relay being killed mid-run. No step in the independent vault's path to
`SOLVER AUTHORISED / LIVE` touched anything Arcaidia controls.
