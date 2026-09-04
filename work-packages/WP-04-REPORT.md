# WP-04 completion report

**Date:** 2026-09-04 · **Gate:** met · **Next:** WP-05.

## 1. Gate

> All accept/reject/reprice/pause branches are deterministic and unit-tested.
> Removing the LLM changes nothing about any verdict.

Met. There is no LLM in the package at all: `AgentDecision.narrative` is an
optional field nothing currently writes, and `evaluateIntent` never reads it.

`pnpm test:agent` — **105 tests**. `pnpm test:global` green across all suites.

## 2. What exists

```
packages/agent/src/
  risk/evaluate-intent.ts     the pure decision (29 tests)
  risk/fee.ts                 utilisation curve, surcharge, fee amount (23 tests)
  risk/confirmations.ts       size-tiered thresholds (10 tests)
  risk/default-policy.ts      the V1 policy — every number a decision
  verification/verify-source.ts     independent RPC check (26 tests)
  verification/source-evidence.ts   evidence shape and reader port
  logging/decision-log.ts     audit records and operator summary (17 tests)
```

New script: `pnpm test:agent`, folded into `test:global`.

## 3. Decisions taken

**PAUSE and REJECT are different answers.** Transport unavailable or vault paused
yields PAUSE: nothing is wrong with the intent, the system cannot settle right
now, and a paused solver resumes where a rejected intent does not. A settlement
backlog yields REJECT — a reason to stop adding exposure, not to stop operating.

**Both fee ceilings reject rather than clamp.** Exceeding the user's `maxFeeBps` is
a refusal, because silently charging less would hide a mispriced risk. Exceeding
the protocol ceiling is also a refusal, because charging the ceiling would mean
knowingly taking risk already priced as underpaid. This needed a new
`FEE_EXCEEDS_PROTOCOL_CEILING` reason in the domain to stay distinguishable.

**Fee amounts round up, toward the vault.** Rounding down would let a caller pay
less than the quoted rate on every amount that divides awkwardly.

**No observed settlement latency is treated as "not slowing".** Absence of evidence
is not evidence of a backlog, and the exposure caps still bound the downside if
that call is wrong.

**Verification is pure over evidence, not a fetch.** The impure half is a narrow
`SourceChainReader` port. Every rejection branch is therefore reachable in a unit
test rather than only against a live chain — which is why there are 26 of them.

**Amounts in decision records serialise as decimal strings.** `bigint` does not
survive `JSON.stringify`, and a number loses precision above 2^53 — about nine
billion units of a six-decimal asset, well inside what an LP vault holds.

## 4. Q9 answered

Confirmation thresholds: **1 / 3 / 6** for intents up to 1,000 / 10,000 / 25,000
USDC, with the strictest requirement applying above the top tier rather than
falling through to zero.

Sepolia produces blocks roughly every twelve seconds and CCTP Standard Transfer
waits for finality regardless, so these thresholds cost the user seconds while
the canonical leg costs minutes. Low enough to demo honestly, high enough to be a
real reorg defence at these sizes. The reasoning is written into
`default-policy.ts` for the README to lift verbatim.

Tiers are sorted inside `requiredConfirmations` rather than trusted to the policy
author, so a mis-ordered policy cannot silently under-require.

## 5. Findings

**One test bug.** A precision assertion compared a numeric literal the JavaScript
parser had already rounded, so both sides matched and the test proved nothing.
It now asserts the property that matters: the string converts back to the exact
bigint, and routing it through a number does not survive.

## 6. Deliberately not built

**4.11, the LLM narration hook.** It is explicitly non-load-bearing, and it is
better placed once there is a UI to show it in — building it now would mean
writing a feature with no way to see whether it reads well.

**The viem `SourceChainReader` implementation.** The port exists and the pure
verifier is fully tested against it. The RPC adapter belongs with WP-05's
orchestration, where it is first actually called.

## 7. Open

**Q10, the fee split**, is now encoded in three places: the vault's share price,
the rounding suite, and the agent's quote. Still changeable, but no longer a
single-file edit.
