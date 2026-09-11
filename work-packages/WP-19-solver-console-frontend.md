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
- [x] **19.2 Wire `use-solver-telemetry.ts` to the real Relay SSE stream** (WP-18.4). Opens a
      browser `EventSource` at `GET {solverTelemetryUrl}/v1/telemetry/vault/{chainId}/{vaultAddress}
      /stream`; the Relay pushes a full `VaultTelemetryState` snapshot on connect and on every
      change, so this hook never diffs, it just replaces. Client-side narrows `stage` to the four
      pre-chain values as a belt on top of the Relay's own WP-18.3 rejection — a stray onchain
      value on the wire still can never reach the orb as a "stage". Resets to `loading` on a
      vault/chain change so a switch never shows the *previous* vault's last-known telemetry while
      the new stream connects; closes the old `EventSource` first. `SolverTelemetry.lastHeartbeatAt`
      corrected to `number | null` (was non-nullable, inconsistent with `OwnedVault`'s own field of
      the same name) — `0` must mean "the Relay really said zero", never "never happened"
      (`data-state.ts`'s own rule). Added a real `online: boolean` field, read directly from the
      Relay's own heartbeat-timeout sweep (WP-18.2) — `SolverOrb` previously re-derived "fresh"
      from a hardcoded 45s client-side constant that didn't even match the Relay's own configured
      timeout; now it just trusts the source of truth instead of guessing a second one. Sets up
      `apps/web`'s test harness from scratch (`vitest` + `@testing-library/react` + `jsdom` — none
      existed before this) with a controllable fake `EventSource`, wired into `test:web` /
      `test:global`.
- [ ] **19.3 Solver Console state machine**, reading from the right source per stage: `SCANNING →
      INTENT DISCOVERED → VERIFYING SOURCE → FORMULATING FILL → SUBMITTED` from telemetry;
      `FAST FILL CONFIRMED → AWAITING CCTP → SETTLED` from RPC/contract/Graph, overriding telemetry
      the moment onchain state exists; `LOST RACE → SCANNING` when another vault's `filledBy` wins.
- [ ] **19.4 `SOLVER DETECTED → SOLVER AUTHORISED` transition.** Reads authorisation directly from
      the vault contract (`isAuthorisedSigner`), never inferred from telemetry pairing alone —
      telemetry proves the runtime is alive; the vault contract is the only source of whether it
      may act.
- [x] **19.5 Re-link `/earn` and `/console` in `top-bar.tsx`**, removing the comment that gated
      them out pending this phase — both are now backed by real WP-16/WP-18 infrastructure.

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
