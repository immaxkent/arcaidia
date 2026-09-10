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

- [ ] **14.1 `buildQuote(request, deps)`.** New pure-ish function in `packages/agent/src/risk/` (or
      alongside `evaluate-intent.ts`): builds a synthetic `Intent` from the request (amount,
      `maxFeeBps`, `sourceChainId`, `destinationChainId`; fields `evaluateIntent` doesn't use for
      pricing — `intentId`, `sender`, `recipient`, `nonce` — take placeholder values, confirmed
      during implementation which ones actually matter), reads live `VaultState` +
      `SettlementHealth` from the already-wired `ObservationProvider`, and calls `evaluateIntent`
      with the best-case `EvaluationContext` above.
- [ ] **14.2 HTTP surface on the existing solver entrypoint.** `POST /quote` (or a small sibling
      server sharing `buildSolverDependencies`'s output) — request: `{ amount, maxFeeBps,
      sourceChainId, destinationChainId }`; response: the `AgentDecision` fields plus an explicit
      `estimatedUnderAssumption: true` (or equivalent) marker. Runs in the same process as the
      solver worker so it never duplicates vault-reading or policy logic — see Traps for why a
      standalone service was considered and rejected for V1.
- [ ] **14.3 CORS + no-auth for V1.** Public endpoint, same trust level as the public subgraph
      endpoints already called directly from the browser. Rate-limiting is worth a cheap guard
      (a quote is nearly free to compute, but not free of RPC/subgraph calls) — not a blocker.
- [ ] **14.4 Frontend wiring.** `useIntentQuote` (`apps/web/src/hooks/arcaidia/use-intent.tsx`)
      calls the new endpoint, debounced on amount/fee-ceiling change. The UI must visibly mark the
      result as an estimate (e.g. "Estimated — final terms set when your transfer confirms"), not
      present it with the same confidence as a settled decision.
- [ ] **14.5 `VITE_SOLVER_QUOTE_URL` (or reuse `VITE_SOLVER_TELEMETRY_URL`'s host if colocated)**
      added to `apps/web/.env.example` and `lib/arcaidia/config.ts`'s `SERVICES`, following the
      existing pattern exactly.
- [ ] **14.6 Deployment.** The solver process needs to be reachable at a stable URL from the
      browser — see Traps. Not a new requirement this WP introduces, but the first place it
      becomes *blocking* rather than a background concern, since the browser calls it directly and
      synchronously (unlike the settlement/solver workers, which only need to reach RPC/Iris/Graph
      outbound).

## Tests

- Unit: `buildQuote` against fixed `VaultState`/`SettlementHealth` fixtures — happy path (ACCEPT
  with a fee inside policy), and every `evaluateIntent` refusal branch already covered in WP-04's
  own suite, reused here rather than re-derived (transport unavailable, vault paused, backlog,
  size cap, exposure cap, user ceiling exceeded).
- Integration: the HTTP handler against a live-ish `ObservationProvider` fake — malformed request,
  unsupported chain pair, amount of zero.
- Frontend: `useIntentQuote` happy path renders real numbers; endpoint unreachable renders
  `unavailable`, not a stale or fabricated quote; debounce actually debounces (no request storm
  while typing).

## Acceptance gate

Entering a real amount on the Transfer page returns a real, risk-engine-computed estimate — fee,
output amount, and the same refusal reasons a real submission would hit (e.g. "exceeds your fee
ceiling") — sourced from the same live vault state and policy the solver acts on, not a fabricated
or hardcoded number.

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
