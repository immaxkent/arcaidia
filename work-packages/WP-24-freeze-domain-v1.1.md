# WP-24 — Freeze the shared domain model v1.1 (M24)

**Objective:** one canonical `Intent` v1.1, one hash, one fee-policy type, one swap-adapter
interface, one hook encoding — declared and fixture-locked in `packages/domain` and
`contracts/src/libraries` *before* any contract, indexer, solver or frontend changes. Everything
downstream imports these; nothing downstream re-declares them.

**Depends on:** `main` @ `9396c9f`. **Blocks:** WP-25, WP-26, WP-27, WP-28, WP-32, Line 1.
**Stack:** `packages/domain`, `contracts/src/libraries`, `contracts/src/interfaces`. No deploys.
**Decisions:** D5, D7, D8, D9.

## Sub-tasks

- [x] **24.1 `Intent` v1.1 struct + typehash, both languages.** `ArcaidiaTypes.sol` `Intent` gains
      `uint8 intentVersion` (first), `address tokenOut`, `uint256 targetMinOut` (last two).
      `IntentLib.INTENT_TYPEHASH` and `intent-id.ts`'s `INTENT_TYPEHASH` become the v1.1 string
      (`V2-MIGRATION-PLAN.md` §D). `IntentParams` gains the three fields; `INTENT_VERSION = 1`
      exported; `USDC_TOKEN_OUT = address(0)` sentinel documented. Delete `IntentOpportunity`
      (unused since WP-15).
- [x] **24.2 Shared test vectors.** `packages/domain/test/fixtures.ts` + `contracts/test/IntentId.t.sol`:
      four vectors — USDC-only (`tokenOut=0,targetMinOut=0`), trade intent, mirrored direction,
      max-width `nonce`/`amount`/`targetMinOut`. Each asserts the *literal expected hex* on both
      sides, plus mutation tests (every field, including `intentVersion`, changes the id).
- [x] **24.3 `FeePolicy` type + `FeePolicyLib.sol`.** Struct per D7; `feeBpsAt(policy, utilisationBps)`
      pure step function in Solidity and TS (`packages/domain/src/fee-policy.ts`); `validate()`
      invariants (ascending thresholds ≤ 10000, non-decreasing fees, critical ≤ 150). Shared vectors
      at every boundary (49.99/50/74.99/75/89.99/90/100%).
- [x] **24.4 `IntentHookLib.sol` + `intent-hook.ts`.** `encode(intentId, recipient)` =
      `abi.encode(uint8 HOOK_VERSION=1, bytes32, address)`; `decode(bytes)` with version check.
      Vector-locked both sides. `SettlementReference` gains optional `hookData`.
- [x] **24.5 `ISwapAdapter.sol` + TS `SwapAdapter` port + `config/markets.ts` shape** — exactly as
      `LINE-1-UNISWAP-INTERFACE.md` §2–§4, with `SWAP_INFRASTRUCTURE` all `null`. This is the Line 1
      handoff; it lands first so `v2-uniswap` can branch.
- [x] **24.6 Domain types for downstream — scoped to what can be populated today.** Done:
      `DecisionReason` +`TRADE_NOT_SUPPORTED`, `FEE_ABOVE_VAULT_POLICY`; `ports.ts` +`SwapAdapter`,
      `IntelligenceProvider`; `types/intelligence.ts` (`EcosystemIntelligence` etc.);
      `SettlementReference.hookData?`; `LEGACY_V1_INTENT_FIELDS` so the live v1 observation
      path stays honest until WP-25/28 read real columns; `QuoteRequest` gains optional
      `tokenOut`/`targetMinOut`. **Deferred to WP-28, deliberately:** `VaultState.feePolicy`/
      `currentFeeBps` (no provider can read them until the v2 vault exists — adding required
      fields now would force fabricated values), `RiskPolicy` fee-field removal and the
      `FillSubmitter` signature (both are the solver rewrite itself, not schema).
- [x] **24.7 Event signatures written down, not yet emitted.** `contracts/src/interfaces/IArcaidiaEventsV2.sol`
      declares `IntentCreated` v2, `FastFilled` v2 (+`feeBps`), `VaultCreated`, `SettledWithProof`,
      `DeliveredViaSwap`/`SwapFellBack` — the frozen shapes WP-25/26 implement and WP-27 indexes.

## Tests

- [x] `pnpm test:shared-domain` (143 tests) — vectors, mutation, fee-policy boundaries, hook round-trip.
- [x] `forge test --match-contract IntentId` — identical literal hashes; `FeePolicyLib` boundaries.
- [x] `pnpm typecheck` failed everywhere an `Intent` literal lacks the new fields — fix by
      construction (fixtures, `build-quote.ts`, web) so no v1 assumption survives silently.

## Acceptance gate — met 2026-09-11

Vectors `usdcOnly 0x96a1…8058`, `trade 0xa8d9…7f69`, `mirrored 0xb699…1cf2`, `maxWidth 0x6854…1e39`,
typehash `0x2c66…413e`, hook `abi.encode(1, id, recipient)` — all asserted literally on both sides.
`IntentLib` uses two concatenated `abi.encode`s (stack depth under `via_ir = false`); a test proves
the concatenation equals the single flat encode.

Both languages produce the same four `intentId`s and the same fee at every tier boundary; the
Line 1 interface files exist unchanged from `LINE-1-UNISWAP-INTERFACE.md`; `pnpm test:global`
green (contracts still compile against the widened struct — no behaviour change yet).
