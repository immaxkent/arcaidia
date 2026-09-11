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
| [07](WP-07-golden-local-e2e.md) ✅ | M7 | Golden local E2E | 06 | One command runs the full economic lifecycle deterministically. |
| [08](WP-08-the-graph.md) ✅ | M8 | The Graph integration | 07 | Disabling Graph stops automation; live data changes decisions. |
| [09](WP-09-circle-agent-wallet.md) ✅ | M9 | Circle Agent Wallet | 07 (08 preferred) | Real Agent Wallet authority signs a bounded fill; core logic unchanged. |
| [10](WP-10-cctp-real-usdc.md) ✅ | M10 | Real CCTP & USDC config | 09 | Real canonical transfer reimburses the opposite-chain vault. |
| [11](WP-11-full-sponsor-e2e.md) ✅ | M11 | Full sponsor E2E | 08, 09, 10 | One repeatable demo proves every sponsor integration is load-bearing. |
| [12](WP-12-submission-hardening.md) ⏸ | M12 | Submission hardening | 11 | Arc/Circle, Graph and Privy checklists fully evidenced. |
| [13](WP-13-freeze-v1.md) ✅ | M13 | Freeze V1 | 12 | V1 tagged; all tests and the qualifying demo green. |

## Status as of 2026-09-10

**V1 is frozen, tagged `v1.0.0`.** WP-00 through WP-11 and WP-13 are complete and live-verified —
Circle Agent Wallet and real CCTP both landed 2026-09-10, closing what the 2026-09-04 snapshot
above still called open. WP-03 (Privy) shipped live, not paused, once a Privy app id arrived.
**WP-12 (submission hardening — architecture diagram, demo video, README bounty-mapping section,
LICENSE) is deliberately deferred, not blocked** — the user's call, to avoid redoing it once
`intent-market` branch work and the Substreams contribution land; it will be picked up close to
the 2026-09-13 submission deadline. Post-freeze work (the intent market, see
`WP-INTENT-MARKET.md` and its own WP-15+ sub-packages) develops on the `intent-market` branch and
does not touch this tagged state.

```
pnpm test:global      everything below, in order
pnpm test:shared-domain   94 tests   packages/domain
pnpm test:agent          182 tests   packages/agent
pnpm test:settlement      73 tests   packages/settlement
pnpm test:sc-eth         246 tests   contracts, Ethereum as source
pnpm test:sc-arc         246 tests   contracts, Arc as source
pnpm test:e2e             21 tests   two anvil chains, the full lifecycle
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

## Priority order from 2026-09-06

**Historical — superseded by the 2026-09-10 status above; every credential blocker below has
since landed.** Left as-is rather than rewritten, as a record of the actual sequencing under
uncertainty.

WP-07 is done, so the critical path is no longer the work-package numbering.
Re-ordered around what unlocks prize coverage and what is blocked on credentials:

| # | Work | Why here | Blocked on |
| --- | --- | --- | --- |
| 1 | **WP-03** Privy frontend | Every Arc prize requires a working frontend; Privy's two bounties have zero coverage without it | A Privy app id, at the end |
| 2 | **P1 upgrade** Subgraph MCP | A second Graph product, half a day, unlocks a $5,000 prize we currently fail on a technicality | — |
| 3 | **WP-09** Circle Agent Wallet | The machine authority the Arc agentic prize turns on | Circle credentials |
| 4 | **WP-10** Real CCTP and USDC | Canonical settlement for real; also produces the deployed addresses | Circle credentials, funded keys |
| 5 | **WP-08 deploy** Subgraphs to Studio | Needs the start blocks WP-10 produces | A Graph API key |
| 6 | **WP-11** Full sponsor E2E | Everything live, repeated until reliable | 3–5 above |
| 7 | **WP-12** Submission hardening | Diagrams, README, demo script, video | 6 |
| 8 | **WP-13** Freeze V1 | Tag and protect | 7 |

WP-03 and the P1 upgrade sit first deliberately: both are unblocked, and doing
them while credentials are gathered means no idle time.

## Roadmap after V1 freezes (WP-13)

Fixed order, confirmed 2026-09-07. Nothing in this tier starts before WP-13 is tagged, and its
frontend does not start before its backend exists — there is nothing to wire against otherwise.

1. **Solver network production and integration** — the intent market, the reference solver
   runtime, telemetry, and the Solver Console frontend. See `WP-INTENT-MARKET.md`, which
   contains the full design, including the explicit boundary between V1's protocol-owned House
   Vault (unchanged, no third-party onboarding) and the post-V1 permissionless model (every
   participant, House Vault included, deploys and authorises their own vault; no Arcaidia
   approval).
2. **V2 — Uniswap.** Generalised swap intents, per §20.4 of the specification.
3. **V3 — Hedera/x402.** Machine-payable solver services, per §20.5 of the specification.

## Bounty requirements

[BOUNTY-REQUIREMENTS.md](BOUNTY-REQUIREMENTS.md) maps every targeted sponsor requirement to the
artefact that proves it and the work package that produces it. It is the checklist WP-12's gate is
scored against; consult it when a work package's scope is in question, because several requirements
are only satisfiable if the right evidence is captured while the work is being done.

## V2/V3 phase — intent v1.1, vault fee policies, CCTP metadata, Uniswap, Hedera (2026-09-11)

Plan of record: [V2-MIGRATION-PLAN.md](V2-MIGRATION-PLAN.md) (repo audit, breaking changes,
dependency order, branch plan, what needs the owner). Line 1 handoff:
[LINE-1-UNISWAP-INTERFACE.md](LINE-1-UNISWAP-INTERFACE.md). Decisions D5–D10 in
[DECISIONS.md](DECISIONS.md). Branch `v2-core`; `main` untouched until the integration gate.

| WP | Title | Depends on | Gate in one line |
| --- | --- | --- | --- |
| [24](WP-24-freeze-domain-v1.1.md) | Freeze domain v1.1 (intent, hash, fee policy, swap adapter, hook) | main | Same four `intentId`s from Solidity and TS; Line 1 interface landed. |
| [25](WP-25-router-cctp-hook.md) | Router v2 + CCTP hook metadata | 24 | Every burn carries `(intentId, recipient)`; event has every solver field. |
| [26](WP-26-vault-fee-policy-factory-receiver.md) | Vault fee policy, on-chain maxFee, factory, receiver proof | 24 (25) | Vault rejects fees above user ceiling or posted tier; `settleWithProof` routes from attested bytes. |
| [27](WP-27-indexing-migration.md) | Subgraph/Nest migration | 25, 26 | Enriched `Intent`, dynamic vault discovery, re-seed request complete. |
| [28](WP-28-solver-settlement-migration.md) | Solver + settlement migration | 24–27 | Solver prices from its vault; two instances fill independently. |
| [29](WP-29-integration-gate.md) | Local integration gate | 25–28 | Seven v2 scenarios both directions; `test:global` green. |
| [30](WP-30-frontend-migration.md) | Frontend migration | 26, 27, 29 | Explicit max fee on chain; vault created with its own policy. |
| [31](WP-31-coordinated-redeploy.md) | Coordinated redeploy + 3 vaults + 3 solvers | 29, 30, owner | Live market with heterogeneous vaults; closes WP-16/20. |
| [32](WP-32-market-activity-loadgen.md) | Automated market activity | 24 (write) / 31 (run) | ~20% organic scarcity, configurable. |
| [33](WP-33-ecosystem-intelligence-surface.md) | Ecosystem intelligence surface | 27 | Real metric set served; baseline solver unchanged without it. |
| [34](WP-34-uniswap-execution-merge.md) | Uniswap execution merge | 31 + Line 1 | Trade intents deliver `tokenOut`, no redeploy. |
| [35](WP-35-hedera-x402-gateway.md) | Hedera x402 gateway (outline) | 33 | Paid intelligence optional; protocol unchanged. |
