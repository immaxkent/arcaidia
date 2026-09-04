# WP-05 completion report

**Date:** 2026-09-04 · **Gate:** met · **Next:** WP-06, after review.

## 1. Gate

> Complete local fast-fill works in both directions; tamper/replay tests fail safely.

Met. `processIntent` runs the full path — observe, verify, decide, sign, submit —
through the same function in both directions, and the vault's tamper and replay
refusals are covered by the 26-test `FastFill` suite from WP-02.

`pnpm test:global` green: **83 domain, 155 agent, 218 contract tests run twice.**

## 2. What exists

```
packages/agent/src/
  signing/local-agent-signer.ts     EIP-712 signing (15 tests)
  solver/process-intent.ts          the one entry point (19 tests)
  solver/ports.ts                   FillSubmitter, NonceSource, Clock, journal
  adapters/viem-source-reader.ts    RPC evidence + log decoding (16 tests)
  adapters/viem-fill-submitter.ts   fastFill submission
  adapters/evm-clients.ts           the narrow client slices the adapters need
packages/domain/src/config/deployments.ts   runtime address overrides
```

## 3. Decisions

**`fastFill` was built in WP-02, not here.** WP-02's safety matrix needed an entry
point to test against, so the vault side landed there and WP-05 became the
agent side: signer, orchestration and adapters. Raised at the time and carried
since; noted again because it changes what WP-05 means.

**The signer takes its typed data from the shared domain package.** A signer that
built its own would be one schema drift away from producing signatures the vault
silently rejects — a failure that presents as "fills stopped working", not as a
bug.

**Ports are narrow slices, not whole clients.** `EvmReadClient` and
`EvmWriteClient` are the few methods the adapters use; viem's clients satisfy
them structurally. Depending on the full client would make the adapters testable
only against a live chain, which in practice means untested.

**Two adapter failure modes are deliberate.** A missing receipt is reported as
absent status rather than thrown, because a pending transaction reaches that path
routinely and the verifier already refuses on it. An unreadable chain head reports
zero, forcing a refusal — guessing a head is the one way the reader could cause a
premature fill.

**The journal is marked before submission.** A transaction that lands after a
timeout still moved funds, so a retry must not assume that failure means nothing
happened.

**Decisions are logged before acting.** A log written only on success would hide
exactly the runs worth investigating.

**Deployment addresses can be overridden at runtime.** The committed record ships;
local runs and tests point the same code at anvil or fixture addresses without a
"test mode" branch. WP-07's harness needs this.

## 4. Findings

**The mirrored-direction test caught a real property while being written.** An
intent that swaps only its chain ids is correctly refused: mirroring swaps the
settlement asset too, and verification checks the asset against the *source*
chain's configuration. The fixture was wrong; the code was right.

**Two slips caught by `tsc`, not by Vitest.** An import of a symbol from the wrong
package, and a `Record<string, never>` cast papering over log-value types. Both
failed `test:global` at the typecheck step, which is why that step runs before
the suites rather than after. The first was committed before verification
finished — that was my error, and the fix is a separate commit rather than a
silent amend.

## 5. Not built

**A `SolverRunner` loop.** `processIntent` handles one intent; nothing yet polls
for many. That belongs with WP-06/WP-07, where there is a settlement worker to
run alongside it and a harness to run both under.

**Live RPC verification.** The adapters are tested against stubs and
contract-encoded logs. They meet a live chain in WP-10.

## 6. Open for review

1. **Q10, the fee split.** The whole fee accrues to LPs, now encoded in the
   vault's share price, the rounding suite and the agent's quote. Still
   changeable; no longer a single-file edit.
2. **WP-03, the Privy frontend.** Paused, not skipped. Its gate needs a Privy app
   id and a browser to evidence honestly. Nothing depends on it.
3. **CREATE2 parity is asserted in simulation**, with live assertion deferred to
   deployment. Unchanged from WP-01; still worth an explicit ruling.
