# WP-04 — Deterministic agent intelligence (M4)

**Objective:** a pure function that decides whether to advance LP capital, and at what price.
No I/O, no network, no LLM in the decision path.

**Depends on:** WP-00. **Parallel with:** WP-02, WP-03. **Blocks:** WP-05.
**Stack:** Node.js, TypeScript, Vitest.

## The signature

```ts
evaluateIntent(
  intent: Intent,
  vaultState: VaultState,
  settlementState: SettlementState,
  riskPolicy: RiskPolicy,
): AgentDecision   // { verdict: ACCEPT | REJECT | PAUSE, feeBps, outputAmount, reason, inputsUsed }
```

Pure. Deterministic. Same inputs → same output, forever. `inputsUsed` records the exact
Graph-derived values behind the quote — that record is a spec requirement (§12) and the substance
of the demo's decision panel.

## Sub-tasks

- [x] **4.1 `RiskPolicy` shape.** Reserve floor, single-intent cap, max total unsettled exposure,
      utilisation fee curve, settlement-age thresholds, CCTP-health thresholds, confirmation
      threshold by intent size, base fee bps, max fee bps.
- [x] **4.2 Liquidity gate.** Reject if `outputAmount > availableLiquidity - reserveFloor`.
- [x] **4.3 Exposure gate.** Reject if post-fill outstanding exposure would exceed the cap.
- [x] **4.4 Size gate.** Reject above single-intent cap.
- [x] **4.5 Utilisation pricing.** Fee rises with vault utilisation along an explicit, tested curve.
- [x] **4.6 Settlement-backlog response** (spec §18). Derive `oldestUnsettledIntent`,
      `pendingCCTPValue`, `averageSettlementLatency` from settlement state, then:
      normal → accept; slowing → raise fee and/or shrink max fill; backlog too large → reject;
      CCTP unavailable → **PAUSE** new fast fills (the settlement agent keeps reconciling).
- [x] **4.7 User ceiling.** The quoted fee may never exceed `intent.maxFeeBps` — if the risk-priced
      fee does, the verdict is REJECT with reason `FEE_CEILING_EXCEEDED`, not a silent clamp.
- [x] **4.8 Deadline & confirmation policy.** Reject expired intents; require confirmations scaled
      by size (Q9 — pick and justify the demo threshold).
- [x] **4.9 Source verification module** (separate, impure, also in this WP):
      `verifySourceTransaction(intent, rpcClient)` checking tx success, correct router target,
      `IntentCreated` present with matching fields, CCTP initiated for the same amount/destination,
      approved token, correct destination, confirmation threshold met, deadline valid, not already
      filled. **The Graph is never sufficient** — this runs against RPC before any decision is acted on.
- [x] **4.10 Decision logging.** Structured JSON per decision: intent, every input, thresholds hit,
      verdict, fee. Persisted for the demo and for the Graph-derived-inputs requirement.
- [ ] **4.11 Optional LLM narration** behind a flag, downstream of the verdict, incapable of
      changing it. Nice for the demo; must be provably non-load-bearing.

## Tests (Vitest — this is the densest test suite in V1)

Table-driven, one case per branch, plus boundary cases at every threshold (exactly at the floor,
one wei under, one over). Property test: for any random valid state, the quoted fee never exceeds
`maxFeeBps` and an ACCEPT never breaches reserve floor or exposure cap.
Source verification: tampered amount, wrong recipient, wrong router, failed tx, insufficient
confirmations, missing CCTP initiation, already-filled intent — each rejected.

## Acceptance gate

All accept/reject/reprice/pause branches are deterministic and unit-tested. Removing the LLM
changes nothing about any verdict.

## Traps

- Reaching for the network inside `evaluateIntent`. Keep verification a separate, explicit step.
- Clamping the fee to the user ceiling instead of rejecting — that hides a mispriced risk.
- Thresholds as magic numbers in code rather than fields on `RiskPolicy`.
