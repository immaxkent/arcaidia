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
- [x] **17.2 `packages/telemetry` — event forwarding + heartbeat done; pairing/auth deferred to
      WP-18.** `TelemetryClient` (`reportStage`/`heartbeat`, both `void`, never `Promise` — that
      return type is what makes "never blocks the caller" a compile-time guarantee, not a
      discipline), `HttpTelemetryClient` (fire-and-forget, failures observed through `onError`,
      never thrown), `NoopTelemetryClient` (`TELEMETRY_ENABLED=false`). **Corrected the sub-task's
      own event vocabulary while building it**: `tx_submitted`/`fill_won`/`fill_lost` (as drafted
      above) are onchain-confirmed facts, which `WP-INTENT-MARKET.md` §7 and the frontend's own
      already-implemented `SolverStageId` type both say telemetry must never report — only
      `INTENT_DISCOVERED` / `VERIFYING_SOURCE` / `FORMULATING_FILL` / `SUBMITTING_SETTLEMENT` are
      pre-chain and telemetry-sourced; used that vocabulary instead, matching what the frontend
      already expects. Wired into `processIntent` at all four points, guarded by a local try/catch
      so even a client that throws synchronously can't break a fill — defense-in-depth on top of
      `HttpTelemetryClient`'s own care, not instead of it. `SolverDependencies.telemetry` is
      optional (unset behaves exactly like an explicit `NoopTelemetryClient`), so this touches zero
      existing test fixtures. `config.ts`/`build-dependencies.ts` wire `TELEMETRY_ENABLED` +
      `ARCAIDIA_TELEMETRY_URL` into a real client end to end. **Not done:** the pairing/challenge-
      signing handshake — can't build a client for an API whose shape WP-18 hasn't defined yet;
      same principle as not guessing a cross-chain data format earlier in this branch.
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
- [x] Telemetry sidecar: proven at two layers. `packages/telemetry/test/client.test.ts` — a
      forwarded event's HTTP call failing, or never resolving at all, never blocks or delays the
      caller. `packages/agent/test/process-intent.test.ts` — a telemetry client that throws
      synchronously on every call still lets a fill complete end to end, and each outcome
      (`FILLED`/`DECLINED`/`UNVERIFIED`/`SKIPPED`) reports exactly the stages that outcome actually
      passed through, no more.
- [ ] Kill-the-Relay: full golden-run-equivalent lifecycle, Relay never started, solver completes
      every fill exactly as WP-07's golden run does. (The unit-level version of this claim — a
      telemetry client that fails/throws on everything still lets a fill complete — is done, above;
      this is the full e2e-harness version, once the harness itself is wired to pass a telemetry
      client through.)

## Acceptance gate

Two solver containers, pointed at two different vaults, both running against the same market, one
with telemetry entirely disabled — all still fill correctly. This is the gate; the frontend (WP-19)
has nothing to show until this exists.
