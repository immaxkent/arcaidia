# WP-28 — Solver and settlement-worker migration (M28)

**Objective:** the reference solver evaluates the v1.1 intent against *its own vault's on-chain
fee policy* and fills through the v2 `fastFill`; the settlement worker settles with proof.
Baseline solver stays free of Uniswap and Hedera; both are optional ports.

**Depends on:** WP-24, WP-25, WP-26, WP-27 (Nest columns, or the Studio fallback).
**Blocks:** WP-29, WP-31, WP-32. **Stack:** `packages/agent`, `packages/settlement`.

## Sub-tasks

- [x] **28.1 Observation.** `SqlNestObservationProvider` / `GraphObservationProvider` read
      `intent_version, token_out, target_min_out`; `vaultState()` reads `feePolicy()`,
      `currentFeeBps()`, `swapAdapter()` from the vault (config-class reads, already done for caps)
      and sets `VaultState.feePolicy/currentFeeBps`. Reads `FROM vaults` (plural) and the
      `intent_version/token_out/target_min_out` columns per the re-seed request — i.e. the
      solver now targets the **v2 Nest schema**; it runs against the live v1 Nest no longer,
      which is fine because it cannot run against the v1 contracts either. Nonce workaround
      kept as-is until the re-seed confirms the fix.
- [x] **28.2 `evaluateIntent` — the brief's loop.** Order: transport/pause → backlog → staleness →
      `alreadyFilled` → deadline → confirmations → **trade gate**: `intent.tokenOut != 0` and
      (no `SwapAdapter` port, or `!canSatisfy(...)`) ⇒ `REJECT TRADE_NOT_SUPPORTED` → size
      (stricter of vault `maxFillAmount` / policy) → **price = `vault.currentFeeBps`** (vault is the
      source of truth; `fee.ts` becomes `feeAmountFor` + `effectiveMaxFillAmount` only) →
      `feeBps > intent.maxFeeBps` ⇒ `REJECT FEE_CEILING_EXCEEDED` → capital/exposure → ACCEPT.
      A slowing transport now reduces max fill and can refuse; it never reprices (the vault would reject).
      `DecisionInputs` +`vaultFeeBps`, `feePolicyVersion` (hash of policy).
- [x] **28.3 `processIntent` / `ViemFillSubmitter`.** Pass the canonical `Intent` struct into
      `fastFill(intent, auth, sig)`; `IntelligenceProvider?` optional dependency consulted (if set)
      before `evaluateIntent` and recorded in the decision `narrative` only — never the gate (rule 4).
- [x] **28.4 `POST /quote` v2 — via `evaluateIntent` on the vault's observed tier**, which is the
      same number `IArcaidiaSolverVault.quote` returns (both read `currentFeeBps()`); a direct
      `eth_call` to `quote(Intent)` is a WP-30 nicety for the frontend, not needed for correctness.
      Accepts optional `tokenOut`/`targetMinOut`; a trade-intent quote reports
      `TRADE_NOT_SUPPORTED` until the adapter is wired into quotes (WP-34).
- [x] **28.5 Settlement worker.** `CircleCCTPAdapter.complete()` → `SettlementReceiver.settleWithProof(message, attestation)`
      (one tx) instead of `receiveMessage` + `settle`; `usedNonces` pre-check retained as the
      idempotency signal; `discover-settlements.ts` reads v1.1 columns; `receivers` map supports the
      retired receiver during the transition (old intents: old path).
- [x] **28.6 `.env.example` / `docker-compose.yml`.** `{PREFIX}_LIQUIDITY_VAULT` unchanged;
      `docker-compose.yml` gains profiles `solver-b`, `solver-c` (same image, `.env.solver-b`/
      `.env.solver-c`) for WP-31/32. `INTELLIGENCE_URL` / `SWAP_ADAPTER_MODE` are *documented as
      reserved* in `.env.example` and wired in WP-33 / WP-34 respectively, when their providers exist
      — no dead config parsing today.

## Tests

- [x] `evaluate-intent.test.ts`: every branch above incl. "solver ignores intents above the user's
      acceptable fee" (`vaultFeeBps 60 > maxFeeBps 30`), trade gate with/without adapter, vault price
      used verbatim (never the policy's), and a property test: `feeBps` in the decision always equals
      `vault.currentFeeBps` on ACCEPT.
- [x] `process-intent.test.ts`: fill submission carries the exact intent whose id was verified;
      intelligence provider failure/absence changes nothing (rule 4 guard).
- [x] Settlement conformance suite runs unchanged against mock + Circle adapters; `settleWithProof`
      path idempotent across restart; retired-receiver routing.
- [x] `pnpm test:agent && pnpm test:settlement` (320 / 139).

## Acceptance gate — met at unit level 2026-09-11; the two-instance run is WP-29's scenario 2

Two solver instances with different vault env files, against the WP-29 harness, each fill only
what their own vault's policy and the user's ceiling permit; no shared state between them.
