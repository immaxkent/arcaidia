# WP-05 — Fill authorization path (M5)

**Objective:** close the loop from decision to money moving — EIP-712 signature offchain, verified
onchain — with a local signer, in both directions.

**Depends on:** WP-02, WP-04. **Blocks:** WP-06.
**Stack:** TypeScript, viem, Foundry.

## Sub-tasks

- [x] **5.1 `AgentSigner` interface.** `signFillAuthorization(auth): Promise<Hex>` plus `address`.
      Two implementations planned: `LocalAgentSigner` (this WP) and `CircleAgentWalletSigner`
      (WP-09). **Design the interface against Q4's answer now** — if the Circle wallet can only
      *execute* rather than *sign*, the interface needs an `execute` shape too, and finding that
      out in WP-09 is a rewrite.
- [x] **5.2 `LocalAgentSigner`** using a viem local account and the shared EIP-712 schema from
      `packages/domain`.
- [x] **5.3 Vault signature verification.** `ArcaidiaLiquidityVault.fastFill` recovers the signer,
      checks the allowlist, checks `intentId` unused, agent `nonce` unused, `expiry` not passed,
      amounts within caps, fee within limits, liquidity sufficient, not paused; marks consumed;
      transfers. Short expiry (30–60s) per spec.
- [x] **5.4 Domain separator binding.** The EIP-712 domain must bind `chainId` and the verifying
      vault address, so an authorization for one chain's vault cannot be replayed on the other.
      **Test this explicitly** — it is the sharpest edge in a symmetric bidirectional deployment.
- [x] **5.5 Solver orchestration skeleton.** `processIntent(intent)`: observe → verify (WP-4.9) →
      evaluate (WP-4) → sign → submit fast fill → record. One code path, direction from config.
- [x] **5.6 Submission robustness.** Idempotent submit, nonce management, gas estimation,
      revert-reason decoding into the typed errors from WP-00.

## Tests

Foundry: valid signature fills; tampered `recipient`/`outputAmount`/`intentId` each revert;
signature from a non-allowlisted key reverts; expired authorization reverts; replayed `intentId`
reverts; replayed agent nonce reverts; an authorization built for chain A's vault reverts on
chain B's vault.
Vitest + local chains: full `processIntent` produces a confirmed fast fill, ETH→Arc and Arc→ETH.

## Acceptance gate

Complete local fast-fill works in both directions; every tamper and replay test fails safely.

## Traps

- A domain separator that omits the vault address or chain ID — cross-chain replay in a protocol
  whose entire premise is symmetric deployment.
- Signing before verification. Verify the source receipt first, always.
- An `AgentSigner` interface shaped only around local signing, then discovering in WP-09 that the
  Circle wallet has a different execution model.

---

## Extension — reference solver runtime (Docker, telemetry, pairing)

**Status: not started.** Does not reopen or affect the gate above, already met and reported in
`WP-05-REPORT.md`. This is new scope layered on top of what shipped: `processIntent`,
`AgentSigner` and the adapters built in WP-05/06/08 become a distributable runtime, rather than
staying test/harness code.

**Depends on:** WP-05 (this file), WP-08 (Graph observation). **Targets:** the vault deployed in
WP-01/10 — see the architectural note below on which one.

### The one fact that makes this cheap

*"Authorise the solver operator"* is not new contract surface. It is the existing
`ArcaidiaLiquidityVault.setAuthorisedSigner(address signer, bool allowed) external onlyOwner` —
built in WP-02, unchanged since. **Zero new Solidity.**

**Architectural note, stated rather than silently assumed:** V1 deploys one shared vault per
chain (CREATE2-deterministic), owned by the protocol. So in V1, "authorise the operator" means
*the protocol* (vault owner) calling `setAuthorisedSigner` after a third-party operator's
telemetry pairing proves they hold the claimed key — not the operator authorising themselves
into a vault they deployed. The parked `WP-INTENT-MARKET.md` model has each operator own their
own vault and call the identical function on it. **The mechanic is identical either way; only
who owns the vault differs.** This extension is built once, against V1's existing vault, and
requires no rework if the intent market ships later — see the cross-reference there.

### Two components

- **`arcaidia-solver`** — the existing WP-05/06/08 solver (`processIntent`, `ObservationProvider`,
  `SettlementAdapter`, `AgentAuthority`), packaged to run unattended: watches The Graph, verifies
  source RPC independently (unchanged — WP-04.9's rule holds exactly as built), reads vault
  state, decides, signs, submits `fastFill`. Owns its own operator key — an EOA, or a Circle
  Agent Wallet once WP-09 lands (`AgentAuthority` already abstracts this; no new work there).
- **`arcaidia-telemetry`** — a sidecar with **no vault custody, settlement, or execution
  authority**. Receives lifecycle events from the local solver, sends outbound HTTPS to the
  Arcaidia Telemetry Relay, authenticates via the solver operator key. Cannot move funds by
  construction — it never holds a signing key with vault authority, only the ability to prove
  it observed one.

### Telemetry is observation, never authorization — the same rule already in the codebase

WP-08 already established that The Graph informs discovery but never authorises a fill — the
solver re-verifies independently before risking capital. Telemetry gets the identical treatment,
one level up the stack: it informs the *frontend*, never the *protocol*. If the Relay is offline,
the solver keeps discovering, verifying, deciding, filling and receiving reimbursement exactly as
it does in the WP-07 golden run — nothing in the fill path reads telemetry state. Only the
frontend's live view degrades to "last known via RPC/Graph."

**Reconciliation rule:** every telemetry event is provisional and is overridden by onchain/Graph
state the moment that state exists. `tx_submitted` → RPC receipt; `fill_won` →
`FastFilled`/consumed-intent event; `fill_lost` → the losing receipt; settlement, fees and volume
→ onchain accounting. Telemetry drives the live Solver Console animation between those moments;
it is never the record of what happened.

### Pairing model

Two identities, kept separate throughout: the **solver operator key** (signs fills — EOA or
Circle Agent Wallet) and the **vault owner wallet** (Privy-authenticated human, controls
`setAuthorisedSigner`). Pairing (telemetry proves key possession) and authorisation (vault owner
grants that key execution rights) are independent steps — pairing alone grants zero protocol
rights, matching the request's own distinction exactly.

```
deploy/fund vault (existing)
  → frontend generates non-secret runtime config (VAULT_ADDRESS, CHAIN_ID, RPC_URL, ...)
  → docker compose up -d
  → solver loads/creates operator key
  → telemetry registers with Relay, signs a challenge bound to {vaultAddress, operatorAddress}
  → frontend shows "SOLVER DETECTED — operator: 0x..." (TELEMETRY PAIRED, zero rights)
  → vault owner (Privy) calls setAuthorisedSigner(operatorAddress, true)
  → frontend reads isAuthorisedSigner directly from the vault (authoritative, not telemetry)
  → SOLVER AUTHORISED / LIVE
```

**Vault history attaches to the vault address, never the operator key.** Rotating or revoking a
signer via `setAuthorisedSigner` — already supported, already tested in WP-02 — does not fragment
fill/fee/settlement history, because that history is already indexed by vault, not by signer
(WP-08's subgraph schema).

### Transport

Outbound-only from the solver side: `solver → telemetry sidecar → HTTPS → Relay`. No inbound
ports, no NAT traversal, no publicly exposed solver API. Frontend subscribes via **SSE**
(`GET /v1/telemetry/vault/{vault}/stream`) — chosen over WebSockets because only server-to-browser
push is needed for V1.

Relay surface: `POST /v1/telemetry/pair`, `POST /v1/telemetry/heartbeat`,
`POST /v1/telemetry/events`.

Lifecycle events: `heartbeat`, `intent_discovered`, `source_verification_started`,
`source_verified`, `decision_started`, `decision_rejected`, `tx_submitted`, `fill_won`,
`fill_lost`, `settlement_waiting`, `settlement_confirmed`. Drives the Solver Console state
machine: `SCANNING → INTENT DISCOVERED → VERIFYING SOURCE → FORMULATING FILL → SUBMITTED →
FAST FILL CONFIRMED → AWAITING CCTP → SETTLED`, with `LOST RACE → SCANNING` on a losing race.

### Reference runtime configuration

```
VAULT_ADDRESS, CHAIN_ID, RPC_URL, GRAPH_ENDPOINT
ARCAIDIA_API_BASE_URL, ARCAIDIA_TELEMETRY_URL
SOLVER_KEY  |  Circle Agent Wallet config          # AgentAuthority — WP-05/WP-09, unchanged
TELEMETRY_ENABLED=true                              # on by default; solver runs correctly if false
X402_ENABLED, x402 client config                    # optional — WP-03.10, WP-12.8
RISK_POLICY_CONFIG, LOG_LEVEL
```

Secrets (`SOLVER_KEY`, Circle credentials) live only in runtime `.env`/secrets storage. Never
emitted into frontend JS, URLs, or a copy-paste pairing link — the frontend generates only the
non-secret half of this config; the operator key is generated or loaded locally by the solver
container.

### Sub-tasks (none started)

- [ ] Package `@arcaidia/agent`'s existing solver loop as `arcaidia-solver` — a long-running
      process around `processIntent`, not new decision logic.
- [ ] Build `arcaidia-telemetry` — event forwarder + heartbeat, outbound HTTPS only, no key with
      vault authority.
- [ ] Docker Compose reference stack: both services, `TELEMETRY_ENABLED=true` default.
- [ ] Relay: `pair` / `heartbeat` / `events` endpoints, SSE stream per vault.
- [ ] Frontend: config generator (non-secret), Solver Console state machine consuming the SSE
      stream, `SOLVER DETECTED` → `SOLVER AUTHORISED` transition reading `isAuthorisedSigner`
      directly from the vault contract as the authoritative source.
- [ ] Kill-the-Relay test: full fill/verify/decide/submit/reimburse cycle (the WP-07 golden run)
      passes with `TELEMETRY_ENABLED=false` and with the Relay unreachable. This is the gate.

### Acceptance gate (this extension only)

A solver operator can go from `docker compose up -d` to `SOLVER AUTHORISED / LIVE` in the
frontend using only the documented steps above, **and** the WP-07 golden run passes unmodified
with telemetry disabled or the Relay offline — proving telemetry is observation, not a protocol
dependency.
