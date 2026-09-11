# WP-18 — Telemetry Relay (M18)

**Objective:** the one durable, publicly-reachable service in this whole phase — everything else
is outbound-only. Receives pairing/heartbeat/event pushes from any number of solvers and
republishes them per-vault over SSE for the frontend to watch live.

**Depends on:** WP-17 (the sidecar it receives from). **Blocks:** WP-19. **Stack:** a small HTTP
service, new package (`packages/relay` or hosted alongside `packages/telemetry`).

**Co-located with, but functionally separate from, WP-21** (Substreams-backed vault flow
observability from the ERC-4626 module the parallel Graph-P1 fork published). Same physical
service, different data source and different job — solver lifecycle telemetry here, cross-chain
vault deposit/withdraw history there. Do not merge their scopes or acceptance gates.

## Sub-tasks

- [x] **18.1 `pair`.** A solver's telemetry sidecar proves possession of its operator key by
      signing a server-issued challenge bound to `{chainId, vaultAddress, operatorAddress}` —
      `chainId` added to the binding beyond the original `{vaultAddress, operatorAddress}` framing:
      Arcaidia deploys through CREATE2 with identical salts, so the same vault address already
      recurs across chains today (the committed House Vault does), and a challenge bound to
      address alone could be replayed to pair the *other* chain's vault. Two-step handshake
      (`packages/telemetry/src/pairing.ts`'s `pairWithRelay` on the client,
      `packages/relay/src/pairing.ts` + `RelayStore.issueChallenge`/`confirmPairing` on the Relay):
      `POST /v1/telemetry/pair/challenge` issues a single-use, TTL'd, EIP-191 challenge string;
      `POST /v1/telemetry/pair` verifies the signature recovers to the claimed operator
      (`viem`'s `recoverMessageAddress`, no RPC client needed for a plain EOA — same assumption
      `AgentAuthority` already makes). Grants `TELEMETRY PAIRED` only — explicitly zero execution
      rights (`WP-INTENT-MARKET.md` §7, "two separate lifecycles"). Pairing signing is a plain
      EIP-191 personal-sign, deliberately not EIP-712: it has no business sharing a scheme with
      `FillAuthorization`, which actually moves money. Lives as `LocalAgentSigner.signMessage` — a
      concrete-class-only capability, not added to `AgentAuthority` itself, because that port is
      already settled (`packages/domain/src/ports.ts`'s own doc comment) and pairing is not a
      fill-signing concern.
- [x] **18.2 `heartbeat`.** Liveness only, distinct from pairing: `RelayStore` tracks `paired` and
      `online`/`lastHeartbeatAt` separately, so the console can tell "paired, never heartbeat"
      (`AWAITING SOLVER`) apart from "was online, went quiet" (`SOLVER OFFLINE`) instead of
      collapsing them into one boolean the instant pairing completes. A background sweep
      (`packages/relay/src/heartbeat-sweeper.ts`, wrapping `RelayStore.sweepHeartbeats()`) flips
      exactly the vaults whose heartbeat has actually timed out, on its own schedule — a vault's
      state doesn't wait for its next event to notice it went quiet.
- [x] **18.3 `events`.** `POST /v1/telemetry/events` ingests lifecycle events from a paired
      sidecar. `TELEMETRY_STAGES` (`packages/telemetry/src/types.ts`) is the one list telemetry,
      the Relay, and the agent's own `process-intent.ts` all read — an onchain-confirmed stage is
      rejected by construction, not by remembering to check a second list. Rejects an unpaired
      sender too (`NOT_PAIRED`), separately from an unaccepted stage (`UNACCEPTED_STAGE`).
- [x] **18.4 `GET /v1/telemetry/vault/{chainId}/{vaultAddress}/stream`** — SSE, one stream per
      `{chainId, vaultAddress}`, not per address alone, for the same CREATE2-address-recurrence
      reason as 18.1's challenge binding. Pushes the full `VaultTelemetryState` snapshot on
      connect and on every change (never a diff), so a client that just opened the stream sees the
      same picture one that's been connected the whole time does. `use-solver-telemetry.ts`'s
      `TODO(integration)` stub (WP-19) now has a real endpoint to call.
- [x] **18.5 No authority, ever.** `packages/relay` has zero dependency on `@arcaidia/domain` or
      any signer/RPC client — nothing in the package *can* call a contract or hold a key, not just
      "doesn't." WP-17.4's kill-the-Relay e2e test already proves the corollary: every fill
      completes correctly whether or not this process exists at all.

## Tests

- [x] Pairing challenge/response round-trip (`packages/relay/test/pairing.test.ts`,
      `test/store.test.ts`); a signature from the wrong key, a reused/expired/unknown challenge,
      and a challenge for the wrong `{chainId, vaultAddress}` are all rejected, and a rejection
      never distinguishes which part was wrong.
- [x] An `events` payload claiming an onchain-confirmed stage is rejected — only the four
      pre-chain stages are ever accepted (`test/store.test.ts`, `test/server.test.ts`).
- [x] Heartbeat timeout correctly flips a vault's reported state without touching any other
      vault's — including two vaults that share an address across chains (`test/store.test.ts`).
- [x] SSE stream delivers events for the requested `{chainId, vaultAddress}` only, never
      cross-vault leakage — structural, not just tested: `RelayStore.subscribe` keys listeners by
      vault token, so there is no shared broadcast list a leak could travel through
      (`test/server.test.ts`).
- [x] Entrypoint config (`packages/relay/test/entrypoint/config.test.ts`): every knob is optional
      with a sane default — consistent with 18.5, there is no secret this process needs to start.

## Acceptance gate

A real sidecar pairs, heartbeats, and streams pre-chain stages to a real SSE client for its own
vault only; an attempt to report an onchain-confirmed stage over telemetry is rejected outright.
Live-verified end to end through the real running process, not only `vitest`: started
`packages/relay/src/entrypoint/main.ts` standalone, confirmed `GET /health` and a real
`POST /v1/telemetry/pair/challenge` round trip against it over actual HTTP.
