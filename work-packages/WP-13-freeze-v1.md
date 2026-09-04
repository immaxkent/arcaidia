# WP-13 — Freeze V1 (M13)

**Objective:** tag a known-good V1 so nothing downstream can destabilise it.

**Depends on:** WP-12.
**Stack:** Git, CI.

## Sub-tasks

- [ ] **13.1 Full regression.** Every suite: contracts, unit, golden local E2E, sponsor E2E.
      Plus one final live qualifying run.
- [ ] **13.2 Tag `v1.0.0`** and protect the branch.
- [ ] **13.3 Freeze the addresses.** Deployed contract addresses recorded and immutable in the
      README; the demo environment left funded and working.
- [ ] **13.4 Post-freeze rule.** V2 (Uniswap) and V3 (Hedera/x402) develop on branches. Any change
      that turns a V1 test red is rejected, not fixed forward.
- [ ] **13.5 Extension notes.** Record the V2 entry points — `desiredToken` + `minimumOutput` on
      the generalised intent, and an `ExecutionAdapter` with a Uniswap implementation, reusing V1
      routers/vaults/agent interfaces rather than forking. And V3's `SolverCommerceAdapter`, kept
      isolated from V1 contracts so V1 runs unchanged without Hedera/x402.

## Acceptance gate

All V1 tests and the qualifying demo remain green. Tag exists. V2/V3 work is branch-isolated.

## After the freeze

**V2 — Uniswap.** Generalise the intent outcome: the user specifies *what* they want on the
destination, the solver chooses *how*. Never encode swap calldata in the user's source intent.
Keep LP inventory centred on USDC and transform on the destination side.

**V3 — Hedera/x402.** Expose quote/route/execution as machine-payable services behind an
`x402`-gated endpoint paid on Hedera. A pure surface around the existing solver — not a new
settlement dependency.

Do not start V3 unless V1 and V2 are stable.
