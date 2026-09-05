# Arcaidia V1 — Work Packages

Fourteen gated work packages, WP-00 … WP-13, mapping 1:1 to spec milestones M0–M13.

**A work package is complete only when its acceptance gate is evidenced by passing tests.**
Not when the code "looks done". Gates are the contract; sub-tasks are the suggested route.

## Rules of execution

1. **Gates are hard.** Do not start WP-N+1's *risky* work before WP-N's gate is green. The only
   sanctioned parallelism is listed in the dependency graph below.
2. **Test-first where it protects capital.** Every rule that decides whether LP funds move —
   vault checks, risk-engine branches, replay/expiry — gets a failing test before the implementation.
3. **Commit frequently and chronologically.** Judges manually review commit history; a single
   large final commit is a scored negative. Push after every green sub-task.
4. **Mocks first, sponsors second.** WP-07 (golden local E2E) must be green before The Graph,
   Circle Agent Wallet and real CCTP are substituted — one at a time, in WP-08/09/10.
5. **Both directions, always.** Every scenario is tested ETH→Arc *and* Arc→ETH. A test matrix with
   one direction is an incomplete gate.

## Dependency graph

```
WP-00 domain  ─┬─> WP-01 contracts ──> WP-02 vault safety ─┐
               │                                            ├─> WP-05 fill auth ──> WP-06 mock settlement ──> WP-07 GOLDEN E2E
               ├─> WP-04 risk engine ───────────────────────┘                                                     │
               │                                                                                                  │
               └─> WP-03 Privy UI (parallel from WP-01)                                                           │
                                                                                                                  v
                                            WP-08 The Graph ──> WP-09 Circle Agent Wallet ──> WP-10 real CCTP + USDC
                                                                                                        │
                                                                                                        v
                                                                        WP-11 full sponsor E2E ──> WP-12 hardening ──> WP-13 freeze
```

**Critical path:** 00 → 01 → 02 → 05 → 06 → 07 → 08 → 09 → 10 → 11 → 12 → 13.
**Off critical path (parallelisable):** WP-03 (UI, after WP-01 ABIs land), WP-04 (pure risk engine,
needs only WP-00 types).

## Index

| WP | Milestone | Title | Depends on | Gate in one line |
| --- | --- | --- | --- | --- |
| [00](WP-00-domain.md) ✅ | M0 | Domain & repository contract | — | One shared schema; no duplicated intent/status types. |
| [01](WP-01-symmetric-chain-core.md) ✅ | M1 | Symmetric chain core | 00 | Same contracts on both chains; CREATE2 addresses deterministic. |
| [02](WP-02-vault-safety.md) ✅ | M2 | Bidirectional vault safety | 01 | No LP principal leaves outside policy, both directions. |
| [03](WP-03-privy-user-flow.md) ⏸ | M3 | Privy thin user flow | 01 | A real Privy wallet creates an intent in either direction. |
| [04](WP-04-risk-engine.md) ✅ | M4 | Deterministic agent intelligence | 00 | Every accept/reject/reprice/pause branch unit-tested. |
| [05](WP-05-fill-authorization.md) ✅ | M5 | Fill authorization path | 02, 04 | Local fast-fill works both directions; tamper/replay fail safely. |
| [06](WP-06-mock-settlement.md) ✅ | M6 | Mock canonical settlement | 05 | Fast path + fallback settle correctly; settlement idempotent. |
| [07](WP-07-golden-local-e2e.md) | M7 | Golden local E2E | 06 | One command runs the full economic lifecycle deterministically. |
| [08](WP-08-the-graph.md) | M8 | The Graph integration | 07 | Disabling Graph stops automation; live data changes decisions. |
| [09](WP-09-circle-agent-wallet.md) | M9 | Circle Agent Wallet | 07 (08 preferred) | Real Agent Wallet authority signs a bounded fill; core logic unchanged. |
| [10](WP-10-cctp-real-usdc.md) | M10 | Real CCTP & USDC config | 09 | Real canonical transfer reimburses the opposite-chain vault. |
| [11](WP-11-full-sponsor-e2e.md) | M11 | Full sponsor E2E | 08, 09, 10 | One repeatable demo proves every sponsor integration is load-bearing. |
| [12](WP-12-submission-hardening.md) | M12 | Submission hardening | 11 | Arc/Circle, Graph and Privy checklists fully evidenced. |
| [13](WP-13-freeze-v1.md) | M13 | Freeze V1 | 12 | V1 tagged; all tests and the qualifying demo green. |

## Status as of 2026-09-04

WP-00, WP-01, WP-02, WP-04, WP-05 and WP-06 are complete, each with a report beside its
work package. WP-03 is paused rather than skipped: its gate needs a Privy app id
and a browser to evidence honestly, and it does not block anything.

```
pnpm test:global      everything below, in order
pnpm test:shared-domain   83 tests   packages/domain
pnpm test:agent          155 tests   packages/agent
pnpm test:settlement      45 tests   packages/settlement
pnpm test:sc-eth         218 tests   contracts, Ethereum as source
pnpm test:sc-arc         218 tests   contracts, Arc as source
```

The two contract runs are the same suite with `ARCAIDIA_SOURCE` flipped: both
directions come from configuration, never from duplicated test files.

## Global invariants (must hold at every gate from WP-05 onward)

- No fast fill without a unique source intent and verified CCTP commitment.
- No intent can be fast-filled twice.
- No expired `FillAuthorization` can execute.
- No unauthorised solver signer can move LP funds.
- No fill may breach per-intent, reserve-floor or total-unsettled-exposure limits.
- `FAST_FILLED` and `SETTLED` remain distinct and independently observable.
- The no-solver path results in canonical recipient delivery, never trapped funds.
- The settlement worker is idempotent across retries and restarts.
- Graph/database downtime can halt automation but can never grant authority over funds.
- The UI never labels canonical settlement complete before onchain confirmation.

Keep these as a literal checklist in `tests/invariants/` and re-run it at every gate.

## Open questions to resolve before they block work

Tracked in [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md). Resolve each one *at or before* the work package
that first depends on it — none of them should be discovered late.

## Bounty requirements

[BOUNTY-REQUIREMENTS.md](BOUNTY-REQUIREMENTS.md) maps every targeted sponsor requirement to the
artefact that proves it and the work package that produces it. It is the checklist WP-12's gate is
scored against; consult it when a work package's scope is in question, because several requirements
are only satisfiable if the right evidence is captured while the work is being done.
