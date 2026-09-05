# WP-06 — Mock canonical settlement (M6)

**Objective:** the full canonical lifecycle — LP reimbursement and the no-solver fallback — with
zero external Circle dependency.

**Depends on:** WP-05. **Blocks:** WP-07.
**Stack:** Node.js, TypeScript, `MockSettlementAdapter`.

## Sub-tasks

- [x] **6.1 `SettlementAdapter` interface.** `initiate`, `getStatus(ref)`, `getAttestation(ref)`,
      `complete(ref)`, `health()`. Core domain depends only on this — no Circle-specific calls
      scattered anywhere else in the codebase.
- [x] **6.2 `MockSettlementAdapter`** simulating the real lifecycle including its awkward parts:
      configurable attestation delay, pending→available transitions, transient failures, and an
      "unavailable" mode to drive WP-4.6's PAUSE branch.
- [x] **6.3 Settlement Agent worker.** Polls for fast-filled-but-unsettled intents, tracks the
      message/attestation lifecycle, submits the destination transaction **idempotently**,
      correlates received funds to `intentId`/`cctpRef`.
- [x] **6.4 Reimbursement path.** If `FAST_FILLED`: canonical USDC replenishes the vault,
      outstanding exposure decrements, fee accounting is realised, status → `SETTLED`.
- [x] **6.5 Fallback path.** If **not** fast-filled: canonical USDC is routed to the recipient.
      The user is paid either way; funds are never trapped.
- [x] **6.6 Idempotency & crash safety.** Kill the worker mid-flight and restart it: no double
      submission, no double reimbursement, no lost intent. Test this by actually killing it.
- [x] **6.7 Settlement state feed** for the risk engine: oldest unsettled age, pending value,
      rolling average latency, adapter health — the real inputs behind WP-4.6.
- [x] **6.8 Onchain state is authoritative.** Worker database state is a cache and a queue, never
      a substitute for onchain settlement state. Reconcile from chain on startup.

## Tests

Both directions × both paths (fast-filled → reimburse; no-solver → recipient fallback).
Idempotency: run `complete` twice, run two workers concurrently, restart mid-lifecycle.
Delayed settlement raises the fee via the risk engine; unavailable adapter pauses new fills.
Exposure accounting returns exactly to zero after every intent settles.

## Acceptance gate

Fast path and fallback path settle correctly in both directions; settlement is idempotent across
retries and restarts.

## Traps

- A mock that only models the happy path — then WP-10 is the first time real latency is handled.
- Trusting worker DB state after a restart instead of reconciling from chain.
- Forgetting to decrement exposure on reimbursement; the vault slowly stops accepting fills and
  it looks like a risk-engine bug.
