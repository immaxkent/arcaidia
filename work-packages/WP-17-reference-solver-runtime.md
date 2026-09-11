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
- [x] **17.3 Docker Compose reference stack — one service, not two.** `WP-INTENT-MARKET.md` §7
      originally described `arcaidia-telemetry` as a separate sidecar container; 17.2 built it as an
      in-process library instead (`packages/telemetry`, imported directly by the solver), which
      already satisfies the sidecar framing's three guarantees (outbound-only HTTPS, no custody, the
      solver survives a dead Relay) without inter-process-communication complexity — so
      `docker-compose.yml` wires exactly one `arcaidia-solver` service, not two. `.env.example` gains
      the WP-17 block (`{PREFIX}_LIQUIDITY_VAULT` overrides, `TELEMETRY_ENABLED`,
      `ARCAIDIA_TELEMETRY_URL`); `TELEMETRY_ENABLED` defaults to `false` here, not `true` as
      `WP-INTENT-MARKET.md` §7 eventually intends — no Relay (WP-18) exists yet on this branch, so
      "on by default" would mean every instance silently posting against nothing. **Genuinely
      build-and-run verified, not just written**: Docker Desktop was not running in the sandbox, so
      started it directly and did the full loop myself rather than shipping an unverified Dockerfile.
      Found and fixed a real bug in the process — `corepack enable && corepack prepare pnpm@X
      --activate` during build (as root) does not make pnpm available to the container's own
      unprivileged `solver` user at runtime, because corepack's shim resolves/caches the real binary
      per-user on first use; invisible in a plain `docker run`, but `docker run --network none`
      exposed it immediately (corepack tried to hit the npm registry at runtime and crashed). Fixed
      by installing pnpm as a true global binary (`npm install -g pnpm@10.2.0`) instead, which
      sidesteps the per-user cache entirely — reverified clean under `--network none`. Then verified,
      live, inside a real running container (not only unit tests): boots to a correct `ConfigError`
      with no env; with fake per-chain vault overrides and `TELEMETRY_ENABLED=true`, its own startup
      log shows the overridden chain's vault address, the non-overridden chain's unaffected committed
      default, and the configured telemetry URL, side by side — direct proof WP-17.1 and WP-17.2 both
      hold inside the packaged artifact, not just in `vitest`. Finally validated the compose path
      itself: `docker compose config` parses, `docker compose up -d --build` builds and starts the
      service, its logs show the same live proof, and `curl localhost:8787/quote` from the host got a
      real HTTP response through the `8787:8787` mapping — the compose networking works, not only the
      image.
- [x] **17.4 Kill-the-Relay test.** `tests/e2e/src/harness.ts`'s `WorldOptions` now takes an
      optional `telemetry` client (`solverDeps()` defaults it to `NoopTelemetryClient`, the same
      "correct without telemetry" default the real entrypoint uses) — the harness prerequisite this
      sub-task was blocked on. `tests/e2e/test/kill-the-relay.test.ts` then runs the golden run's own
      fast-path/canonical-path/books assertions, verbatim, with a genuine `HttpTelemetryClient` (not
      a mock) pointed at `http://127.0.0.1:1` — a port nothing listens on, chosen so the connection is
      refused immediately rather than waiting out a routable-but-blackholed address's TCP timeout.
      Every fill and settlement outcome, and every balance assertion, matches `golden.test.ts`
      exactly. A companion assertion confirms the client wasn't inert: `onError` recorded a real
      failed POST for every pre-chain stage the run passed through, proving telemetry was genuinely
      exercised and genuinely failed, not merely configured off. This is the full e2e-harness version
      of the claim `process-intent.test.ts`'s hostile-telemetry-client unit test already made at the
      unit level.

## Tests

- [x] Config-layer proof, `test/entrypoint/config.test.ts`: two `loadSolverConfig` calls with
      different vault overrides stay fully independent, an override on one chain doesn't leak to
      the other, and a malformed override fails loudly rather than falling back silently.
- [x] Container-level version of the same claim: one `arcaidia-solver` container given a
      per-chain vault override plus the committed default on the other chain, both correct and
      independent in the container's own startup log (see 17.3 above) — no shared state, no fallback
      leaking across chains.
- [x] Telemetry sidecar: proven at two layers. `packages/telemetry/test/client.test.ts` — a
      forwarded event's HTTP call failing, or never resolving at all, never blocks or delays the
      caller. `packages/agent/test/process-intent.test.ts` — a telemetry client that throws
      synchronously on every call still lets a fill complete end to end, and each outcome
      (`FILLED`/`DECLINED`/`UNVERIFIED`/`SKIPPED`) reports exactly the stages that outcome actually
      passed through, no more.
- [x] Kill-the-Relay: `tests/e2e/test/kill-the-relay.test.ts` — full golden-run-equivalent
      lifecycle, a real `HttpTelemetryClient` posting against a dead port, solver completes every
      fill and reimbursement exactly as `golden.test.ts`'s golden run does, and a second assertion
      confirms the dead-Relay posts genuinely happened and genuinely failed.

## Acceptance gate

Two solver containers, pointed at two different vaults, both running against the same market, one
with telemetry entirely disabled — all still fill correctly. This is the gate; the frontend (WP-19)
has nothing to show until this exists.
