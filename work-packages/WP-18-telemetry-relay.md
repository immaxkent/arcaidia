# WP-18 — Telemetry Relay (M18)

**Objective:** the one durable, publicly-reachable service in this whole phase — everything else
is outbound-only. Receives pairing/heartbeat/event pushes from any number of solvers and
republishes them per-vault over SSE for the frontend to watch live.

**Depends on:** WP-17 (the sidecar it receives from). **Blocks:** WP-19. **Stack:** a small HTTP
service, new package (`packages/relay` or hosted alongside `packages/telemetry`).

## Sub-tasks

- [ ] **18.1 `pair`.** A solver's telemetry sidecar proves possession of its operator key by
      signing a server-issued challenge bound to `{vaultAddress, operatorAddress}`. Grants
      `TELEMETRY PAIRED` — explicitly zero execution rights, by design (see
      `WP-INTENT-MARKET.md` §7, "two separate lifecycles").
- [ ] **18.2 `heartbeat`.** Liveness only. No heartbeat within a configured window flips the
      console's view of that vault to "SOLVER OFFLINE" / "AWAITING SOLVER" — never "SCANNING".
- [ ] **18.3 `events`.** Ingests lifecycle events from a paired sidecar; **only** the four
      pre-chain stages (`INTENT_DISCOVERED` / `VERIFYING_SOURCE` / `FORMULATING_FILL` /
      `SUBMITTING_SETTLEMENT`) are accepted from telemetry — anything claiming an onchain-confirmed
      stage from this channel is rejected, because that must come from RPC/contract/Graph, never
      telemetry.
- [ ] **18.4 `GET /v1/telemetry/vault/{vault}/stream`** — SSE, one stream per vault, is what
      `use-solver-telemetry.ts`'s current `TODO(integration)` stub is waiting for.
- [ ] **18.5 No authority, ever.** The Relay holds no vault custody and cannot call any contract.
      If it disappears entirely, WP-17.4's kill-the-Relay gate is what proves nothing breaks.

## Tests

- Pairing challenge/response round-trip; a signature from the wrong key is rejected.
- An `events` payload claiming an onchain-confirmed stage (e.g. `FAST_FILL_CONFIRMED`) from the
  telemetry channel is rejected — only the four pre-chain stages are ever accepted this way.
- Heartbeat timeout correctly flips a vault's reported state without touching any other vault's
  stream.
- SSE stream delivers events for the requested vault only, never cross-vault leakage.

## Acceptance gate

A real sidecar pairs, heartbeats, and streams pre-chain stages to a real SSE client for its own
vault only; an attempt to report an onchain-confirmed stage over telemetry is rejected outright.
