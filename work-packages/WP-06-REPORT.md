# WP-06 completion report

**Date:** 2026-09-05 · **Gate:** met · **Next:** WP-07.

## 1. Gate

> Fast path and fallback path settle correctly in both directions; settlement is
> idempotent across retries and restarts.

Met. `pnpm test:global` green: **88 domain, 155 agent, 45 settlement, 246 contract
tests run twice.** New entry point: `pnpm test:settlement`.

## 2. What exists

```
packages/settlement/src/
  adapters/mock-settlement-adapter.ts   the transport, including its awkward parts (16 tests)
  worker/process-settlement.ts          one settlement, advanced one step (17 tests)
  worker/ports.ts                       receiver client, journal
  health.ts                             health derived from the worker's own records (12 tests)
```

## 3. Decisions

**The mock models failure, not just success.** Configurable attestation delay,
transient failures that succeed on retry, and an unavailable mode. A mock that
only modelled the happy path would leave WP-10 as the first time any of it is
handled — against a live network, with real money.

**Time-dependent status is derived on read.** A test advancing its clock sees
exactly what a worker polling a real attestation service would see, so no test
needs to sleep.

**The chain is asked before every action.** The journal is a queue, not truth. A
restarted worker with an empty journal behaves correctly; a worker with a stale
journal does not act on it.

**A failed settlement is deliberately not marked done.** If the transaction
actually landed, the next run's onchain check reconciles it. If it did not, the
next run retries. Marking it on failure would strand an intent on a failure that
never happened — which is the worse of the two errors.

**Health is derived twice.** The transport reports its own, and the worker computes
the same figures from what it has seen. Two sources that must agree beats one that
cannot be checked, and the derived one still answers when the transport is
unreachable — precisely when the risk engine needs it.

**Latency uses a rolling window.** A transport that was slow an hour ago and is
fast now should read as fast now.

## 4. The loop the specification asks for, closed

The health suite drives the **real** risk engine with **derived** health, so the
connection between what the settlement worker observes and what the solver will do
is tested rather than asserted:

| Observed | Verdict |
| --- | --- |
| Healthy, nothing outstanding | ACCEPT at the base fee |
| Slowing | ACCEPT at a higher fee |
| Backlog above policy | REJECT, `SETTLEMENT_BACKLOG` |
| Oldest outstanding too old | REJECT, `SETTLEMENT_BACKLOG` |
| Transport unreachable | PAUSE, `SETTLEMENT_TRANSPORT_UNAVAILABLE` |

## 5. Idempotency, covered explicitly

- Stepped repeatedly: settles once.
- Two workers racing the same settlement: at most one `settle` call.
- Transient completion failure: recovers on the next pass.
- **The crash that matters:** the transaction landed, the worker died before
  hearing about it, and its journal is gone. On restart it discovers the truth
  from the chain and does not pay again.

## 6. Not built

**The polling loop's scheduling.** `runSettlementPass` does one pass; nothing yet
runs it on a timer. That belongs with WP-07's harness, which needs to drive the
solver and the settlement worker together under one clock.

**Discovery of settlements to track.** The journal is populated by the caller. In
the qualifying path that comes from The Graph (WP-08); in the golden E2E it comes
from the harness. Neither exists yet, and inventing a third source now would be
speculative.
