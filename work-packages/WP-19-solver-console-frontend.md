# WP-19 — Solver Console frontend (M19)

**Objective:** wire the frontend surfaces that already exist — `/earn` and `/console`, built ahead
of their backend and deliberately unlinked from the top nav until now — to the real market,
vault contracts and Relay this phase just built.

**Depends on:** WP-16 (market/vault reads), WP-18 (telemetry stream). **Blocks:** WP-20.
**Stack:** `apps/web`.

## What already exists — do not rebuild

`apps/web/src/routes/earn.tsx` (self-service vault deploy + config generator UI),
`apps/web/src/routes/console.tsx` (`SolverOrb`, live state display),
`apps/web/src/hooks/arcaidia/use-solver-telemetry.ts` and `use-solver-metrics.ts` — all real,
already encode the correct rules (telemetry pairing vs. onchain authorisation kept as two distinct
facts). Their data-fetching bodies are `TODO(integration)` stubs returning `unavailableState`
because no Relay existed. This WP replaces those stubs; it does not redesign the pages.

## Sub-tasks

- [ ] **19.1 Config generator.** `/earn` emits the non-secret runtime config block
      (`VAULT_ADDRESS, CHAIN_ID, RPC_URL, GRAPH_ENDPOINT, ARCAIDIA_API_BASE_URL,
      ARCAIDIA_TELEMETRY_URL`) for a vault the connected wallet just deployed — never the operator
      key itself, which the container generates locally.
- [ ] **19.2 Wire `use-solver-telemetry.ts` to the real Relay SSE stream** (WP-18.4) — replace the
      `TODO(integration)` stub, `SERVICES.solverTelemetryUrl` now genuinely resolves.
- [ ] **19.3 Solver Console state machine**, reading from the right source per stage: `SCANNING →
      INTENT DISCOVERED → VERIFYING SOURCE → FORMULATING FILL → SUBMITTED` from telemetry;
      `FAST FILL CONFIRMED → AWAITING CCTP → SETTLED` from RPC/contract/Graph, overriding telemetry
      the moment onchain state exists; `LOST RACE → SCANNING` when another vault's `filledBy` wins.
- [ ] **19.4 `SOLVER DETECTED → SOLVER AUTHORISED` transition.** Reads authorisation directly from
      the vault contract (`isAuthorisedSigner`), never inferred from telemetry pairing alone —
      telemetry proves the runtime is alive; the vault contract is the only source of whether it
      may act.
- [ ] **19.5 Re-link `/earn` and `/console` in `top-bar.tsx`**, removing the comment that currently
      gates them out pending this phase.

## Tests

- Component/hook tests mirroring the existing `DataState` conventions: loading/ready/empty/
  unavailable/error all render correctly, no fabricated values on any path.
- State machine: a telemetry-reported stage is correctly superseded the instant a matching
  onchain event/receipt exists.
- Authorisation reads only ever come from the contract, verified by a test that has telemetry
  claim pairing with no matching onchain grant and asserts the console still shows unauthorised.

## Acceptance gate

A freshly deployed, freshly funded vault, run through the reference solver container from WP-17,
shows a correct, live `SCANNING → ... → SETTLED` (or `LOST RACE`) progression on `/console`, and
`/earn`'s authorisation state matches the vault contract exactly, with no fabricated data anywhere
in the DataState chain.
