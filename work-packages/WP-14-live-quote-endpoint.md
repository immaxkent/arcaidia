# WP-14 — Live quote endpoint (M14)

**Objective:** the Transfer page's "Recipient gets / Fee / Estimated arrival" preview answers with
a real, risk-engine-computed estimate instead of `--`. Discovered while wiring the live frontend
against real testnet contracts (post-WP-10) — the preview is the one surface on that page still
unconnected to anything real.

**Depends on:** WP-04 (the risk engine — reused verbatim, not reimplemented), WP-11 (the solver's
live entrypoint — this extends it). **Blocks:** WP-13 (freeze) — the qualifying demo's Transfer
page should not ship with a fabricated or permanently-empty quote preview.
**Stack:** the existing solver process (`packages/agent`). No new package, no on-chain change, no
database.

## What this is not

No contract changes, no new contract, no persistent storage. A quote is a live calculation, not a
record — same inputs at the same moment produce the same answer, and nothing about answering one
needs to be written down anywhere. This is one new HTTP surface on a process that already exists.

## Why this can reuse existing logic almost entirely

`evaluateIntent` (`packages/agent/src/risk/evaluate-intent.ts`) is already a pure function:
`(intent, vaultState, settlementHealth, policy, context) => AgentDecision`. The solver calls it for
real, live, on every pass (`packages/agent/src/solver/process-intent.ts`). Everything a quote needs
— `DEFAULT_RISK_POLICY`, live `VaultState` and `SettlementHealth` via the solver's own
`ObservationProvider` — is already being read inside the same process, on the same
`pollIntervalMs` cadence, for its own decisions. Nothing here is a new data source.

**The one real gap: `EvaluationContext` doesn't exist yet for a hypothetical, pre-submission
amount.** `sourceConfirmations` and `alreadyFilled` describe a transaction that hasn't been sent.
A quote therefore has to state an assumption explicitly, not discover one:

```ts
context: {
  now: currentTime,
  sourceConfirmations: requiredConfirmations(policy, requestedAmount), // assume the threshold is met
  alreadyFilled: false, // trivially true — nothing has been submitted
}
```

This makes the response an **estimate under a stated best-case assumption**, not a binding quote —
the real decision, made against the real observed confirmation count, happens exactly the same way
it does today once an actual intent lands on the source chain. The frontend must present it as an
estimate (see 14.4), not reuse `AgentDecision`'s shape silently as if it were a recorded decision.

## Sub-tasks

- [x] **14.1 `buildQuote(request, deps)`.** Built in `packages/agent/src/risk/build-quote.ts`.
      Builds a synthetic `Intent` (placeholders confirmed unused for pricing: `intentId`, `sender`,
      `recipient`, `inputToken`, `nonce`, `sourceTxHash`, `sourceBlockNumber`, `settlementRef`),
      reads live `VaultState` + `SettlementHealth` from the already-wired `ObservationProvider`, and
      calls `evaluateIntent` with the best-case `EvaluationContext` above. Request validation
      (`InvalidQuoteRequestError`) happens before any observation call.
- [x] **14.2 HTTP surface on the existing solver entrypoint.** `POST /quote` in
      `packages/agent/src/entrypoint/quote-server.ts` (`node:http`, no new dependency), colocated —
      wired into `main.ts` alongside `startSolverWorker`, same `ObservationProvider`, same policy.
      `GET /health` added too, for cheap reachability checks.
- [x] **14.3 CORS + no-auth for V1.** `access-control-allow-origin: *`, `OPTIONS` preflight
      handled. Rate-limiting not added — not a blocker, still worth revisiting under real load.
- [x] **14.4 Frontend wiring.** `useIntentQuote` POSTs to `SERVICES.solverQuoteUrl`, 400ms
      debounced. `transfer-form.tsx` shows the real refusal reason (title-cased) instead of a
      misleading zero on REJECT/PAUSE, and tags every real quote "Estimated".
- [x] **14.5 `VITE_SOLVER_QUOTE_URL`** added to both `apps/web/.env` and `.env.example`, and
      `lib/arcaidia/config.ts`'s `SERVICES.solverQuoteUrl`, following the existing pattern.
- [ ] **14.6 Deployment.** Still open — see Traps. The solver (and therefore the quote endpoint)
      is only reachable while someone runs `pnpm solver:start` locally; nothing durable exists yet.

## Tests

- Unit (13 tests, `test/build-quote.test.ts`): happy path (ACCEPT with a fee inside policy),
  refusal branches (paused vault, transport unavailable, insufficient liquidity, fee ceiling
  exceeded, exposure cap), malformed-request validation before any observation call.
- HTTP (11 tests, `test/entrypoint/quote-server.test.ts`): real requests against a real listening
  server (port 0) — CORS headers, `OPTIONS` preflight, malformed JSON, negative amount, missing
  field, wrong method, unknown path, `close()` actually closing.
- Config (2 tests added to `test/entrypoint/config.test.ts`): `SOLVER_QUOTE_PORT` override and
  validation.

241 agent tests total, typecheck and lint clean across the monorepo.

## Acceptance gate

**Met.** Entering a real amount on the Transfer page returns a real, risk-engine-computed estimate
sourced from live vault state and the real policy. Verified live: ran the actual solver process,
sent the exact request shape and `Origin` header the browser sends, got back a real `REJECT`
(`OBSERVATION_STALE`) computed from the real deposited vault balance through the real risk engine —
the full path, not a mock.

## Traps

- **Reusing `AgentDecision`'s shape without the estimate marker.** The frontend must not present
  this with the same weight as a recorded, post-hoc decision (which is exactly what
  `useSolverDecisions` — still correctly unavailable, no telemetry service exists — is for). A
  quote is a forecast under a stated assumption; conflating the two erodes the "never fabricate a
  value" discipline the rest of this app holds to.
- **A standalone quote microservice**, considered and rejected for V1: it would need its own copy
  of vault-state reading and policy config, immediately at risk of drifting from what the solver
  actually enforces. Colocating in the same process is the only way one policy version is ever in
  force.
- **`settlementHealth()`'s existing limitation carries over unchanged.**
  `GraphObservationProvider.settlementHealth()` (used by the solver today, for real decisions, not
  just this WP) hardcodes `transport: 'HEALTHY'` — it can only tell that the indexer answered, not
  that Iris/CCTP is actually reachable; that knowledge currently lives only in the settlement
  worker's own `CircleCCTPAdapter.health()` and is never published anywhere the solver (or a quote)
  can read it. Practical effect: WP-04.6's "CCTP unavailable → PAUSE" gate is currently unreachable
  in the live system for both real decisions and quotes alike. Out of scope for this WP to fix, but
  worth its own follow-up — the two problems (real decisions, quotes) share one root cause and one
  fix: the settlement worker publishing its real transport health somewhere both can read.
- **Where does the solver process actually run, persistently, at a stable URL?** Every live
  process this session (solver worker, settlement worker) has so far only been run as a foreground
  or backgrounded process on a local machine to verify wiring — never deployed anywhere durable.
  This WP is the first time that gap becomes *blocking*: the browser needs to reach this endpoint
  directly and synchronously, not just have the solver quietly polling RPC in the background.
  Worth resolving once, for all three live processes, rather than per-WP.
- **Found during this WP's live verification, not caused by it:**
  `GraphObservationProvider.vaultState()` hardcodes `reserveFloor: 0n` and `totalShares: 0n` — the
  subgraph never indexes `VaultInitialized`/`ReserveFloorConfigured`, even though
  `reserveFloorBps` is real, owner-configurable contract state. Practical effect: the live solver
  today (quotes and real fills alike) is willing to advance into the reserve floor rather than
  respect it — the exact protection the floor exists to guarantee. Genuine capital-safety gap,
  same severity class as the `fastFill`-after-fallback fix earlier this session. Not fixed here;
  tracked for the WP-12 (submission hardening) pass.
