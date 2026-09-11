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

- [x] **19.1 Config generator.** `/earn`'s `runtimeConfigText()` emits the vault's real
      per-chain env block, in the actual shape `.env.example`/the WP-17.3 Docker Compose stack
      read — `{PREFIX}_LIQUIDITY_VAULT`, an optional `{PREFIX}_RPC_URL` override, `TELEMETRY_ENABLED`
      + `ARCAIDIA_TELEMETRY_URL` — not the sub-task's own original, aspirational field list
      (`VAULT_ADDRESS, CHAIN_ID, GRAPH_ENDPOINT, ARCAIDIA_API_BASE_URL`), written before WP-17/18/22
      existed for real. Deliberately omits a live `SUBGRAPH_URL_{PREFIX}` value — WP-22 already
      made "unset" mean "use Arcaidia's own shared, unlimited indexer," so handing one back here
      would silently reintroduce the account/key requirement WP-22 removed; shown only as a
      commented-out example for an operator who wants their own indexer instead. Never emits the
      operator key itself, which the container generates or loads locally
      (`WP-INTENT-MARKET.md` §7).
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
- [x] **19.3 Solver Console state machine.** New `useIntentOutcome(chainId, intentId)`
      (`apps/web/src/hooks/arcaidia/use-intent-outcome.ts`) queries the Nest's `fills`/
      `settlements` directly for whatever `intentId` telemetry is currently reporting on — the
      real onchain fact telemetry itself cannot know (it only knows what *this* vault submitted,
      never whether it actually landed, or whether a different vault's fill won first).
      `deriveOnchainStage()` (`apps/web/src/lib/arcaidia/solver-stage.ts`) is the pure merge: no
      fill yet → telemetry's own stage stands (`SolverOrb`'s existing `onchainStage ?? telemetry`
      logic, unchanged); a fill exists for a *different* vault → `LOST_RACE`; this vault's own fill
      exists, unsettled → `AWAITING_CANONICAL_SETTLEMENT`; also settled → `SETTLED`. Deliberately
      does not attempt `AWAITING_CONFIRMATION` (submitted-but-not-yet-mined) — an indexer only ever
      reports confirmed state, so that stage would need a real tx-hash-to-receipt RPC watch, a
      genuinely different capability; telemetry's own `SUBMITTING_SETTLEMENT` already covers that
      window honestly, and this hook only ever asserts what the chain has actually confirmed.
- [x] **19.4 `SOLVER DETECTED → SOLVER AUTHORISED` transition.** `use-solver-metrics.ts`, no longer
      a stub, reads `isAuthorisedSigner(candidateOperator)` directly from the vault contract for
      whatever operator address is actually in play — the owner's own typed address on `/earn`, or
      telemetry's reported pairing on `/console` — never inferring the *authorisation fact itself*
      from telemetry, only borrowing telemetry for *which address to ask the contract about*.
      `runtimeStatus` follows the same rule one layer up: the contract's own `paused` always wins;
      otherwise it's telemetry's own `online` (WP-18.2's real heartbeat-timeout sweep), never a
      second, locally-guessed timeout. **Known, stated limitation:** the contract read only
      distinguishes `AUTHORISED`/`UNAUTHORISED` — `PENDING_SIGNATURE`/`REVOKED` would need indexed
      `AuthorisedSignerSet` history, which doesn't exist yet; not fabricated as a middle state.
      `averageSettlementSeconds` stays `null` for the same reason `totalVolume`/`totalFees` don't:
      no cheap indexer aggregate exists for a cross-chain (source-intent-creation vs.
      destination-settlement) latency, and computing it here would mean an expensive full fills
      scan duplicating what `useVaultFills` already does per-row for its own table.
- [x] **19.5 Re-link `/earn` and `/console` in `top-bar.tsx`**, removing the comment that gated
      them out pending this phase — both are now backed by real WP-16/WP-18 infrastructure.

## Tests

- [x] Component/hook tests mirroring the existing `DataState` conventions
      (`use-intent-outcome.test.tsx`, `use-solver-metrics.test.tsx`, `solver-stage.test.ts`, 19
      tests total): loading/ready/empty/unavailable/error all render correctly, no fabricated
      values on any path.
- [x] State machine: `deriveOnchainStage` tested against every transition explicitly — not filled,
      filled-and-settled, filled-by-this-vault-unsettled, and filled-by-a-*different*-vault
      (`LOST_RACE`) — plus case-insensitive vault comparison.
- [x] Authorisation: a test asserts `isAuthorisedSigner` is never even called with no candidate
      operator (authState stays `null`, not a guess), a separate test confirms `false` from the
      contract reports `UNAUTHORISED` outright rather than staying ambiguous, and `paused`
      overriding a live telemetry heartbeat is its own explicit test.

## Acceptance gate

A freshly deployed, freshly funded vault, run through the reference solver container from WP-17,
shows a correct, live `SCANNING → ... → SETTLED` (or `LOST RACE`) progression on `/console`, and
`/earn`'s authorisation state matches the vault contract exactly, with no fabricated data anywhere
in the DataState chain. **Structurally provable today for the House Vault path** (the one vault
genuinely live); the *independent*-vault path (`useOwnedVaults`) still returns
`unavailableState` — that hook needs vault discovery via a factory/registry that does not exist in
this codebase yet (see WP-21's identical finding: `ArcaidiaIntentMarket` has no vault registry
either). Closing that gap is WP-20's own job (20.2: "stand up a second, independent vault + solver
— not a mock"), not this WP's.
