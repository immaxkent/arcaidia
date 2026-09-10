# WP-13 — Freeze V1 (M13)

**Objective:** tag a known-good V1 so nothing downstream can destabilise it.

**Depends on:** WP-12.
**Stack:** Git, CI.

## Sub-tasks

- [x] **13.1 Full regression.** Every suite: contracts (both directions), domain, agent,
      settlement, mcp, e2e — `pnpm test:global`, 2026-09-10, clean run, 0 failures (found and
      fixed a stale generated ABI and a leftover absolute-amount call in the e2e deploy harness
      along the way). Plus the live qualifying run — the user's own second live transfer, judged
      sufficient by the user 2026-09-10.
- [x] **13.2 Tag `v1.0.0`** and protect the branch.
- [x] **13.3 Freeze the addresses.** Recorded in the README's "Deployed addresses (frozen, WP-13)"
      section, 2026-09-10.
- [x] **13.4 Post-freeze rule.** Solver-network/intent-market work (see `WP-INTENT-MARKET.md`)
      develops on the `intent-market` branch, per this rule — first post-freeze phase, before V2
      (Uniswap) and V3 (Hedera/x402). Any change that turns a V1 test red is rejected, not fixed
      forward.
- [ ] **13.5 Extension notes.** Record the V2 entry points — `desiredToken` + `minimumOutput` on
      the generalised intent, and an `ExecutionAdapter` with a Uniswap implementation, reusing V1
      routers/vaults/agent interfaces rather than forking. And V3's `SolverCommerceAdapter`, kept
      isolated from V1 contracts so V1 runs unchanged without Hedera/x402. Deferred: not needed
      until V2 itself starts, and the intent market ships first regardless.

## Acceptance gate

All V1 tests and the qualifying demo remain green. Tag exists. V2/V3 work is branch-isolated.

**Gate met 2026-09-10.**

## After the freeze

**V2 — Uniswap.** Generalise the intent outcome: the user specifies *what* they want on the
destination, the solver chooses *how*. Never encode swap calldata in the user's source intent.
Keep LP inventory centred on USDC and transform on the destination side.

**V3 — Hedera/x402.** Expose quote/route/execution as machine-payable services behind an
`x402`-gated endpoint paid on Hedera. A pure surface around the existing solver — not a new
settlement dependency.

Do not start V3 unless V1 and V2 are stable.
