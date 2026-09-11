# WP-16 — Vault integration with the market (M16)

**Objective:** `ArcaidiaLiquidityVault.fastFill()` claims through the market before doing anything
else, so winning a race and being allowed to pay are the same atomic event — never two steps a
reentrant or racing call could split apart.

**Depends on:** WP-15. **Blocks:** WP-17, WP-20. **Stack:** Foundry, `contracts/src`,
`contracts/script`.

## Fee/deadline scope, settled 2026-09-11

No `FillAuthorization` changes, no cross-chain propagation of the intent's real `maxFeeBps` or
deadline — discussed at length, recorded in `WP-INTENT-MARKET.md` §6. Under first-valid-fill,
price isn't a winning factor, so every vault rationally always charges the ceiling; a user's own
lower preference stays protected exactly where it already is, off-chain, in `evaluateIntent`. What
this WP actually adds instead: **one fixed, non-configurable fee ceiling enforced centrally by the
market** — not each vault's own owner-configurable `maxFeeBps`, which nothing stops a careless or
adversarial third-party vault owner from setting higher. No on-chain fee-curve library — a vault
either can safely take the fill under its own existing utilisation caps or it can't; if it can, it
charges the ceiling.

## Sub-tasks

- [x] **16.0 Universal fee ceiling in `ArcaidiaIntentMarket`.** A fixed `uint16` constant (not
      owner-configurable, not per-vault) — every `claimIntent` call reverts if `feeAmount` exceeds
      that fraction of `outputAmount + feeAmount`, regardless of what any individual vault's own
      `maxFeeBps` allows.
- [x] **16.1 One new line in `fastFill`, before existing logic.**
      `market.claimIntent(auth.intentId, auth.outputAmount, auth.feeAmount);` — everything below it
      (allowlist check, replay, caps, transfer) is today's `fastFill`, unchanged. The external
      function signature does not change; nothing that imports its shape (frontend, domain
      package, solver) needs to change for this WP alone. Also required: a new
      `market` address + `setMarket()` (mirrors `setSettlementReceiver`'s existing pattern) — a
      vault with no market configured refuses every fill outright (`NoMarketConfigured`) rather
      than silently behaving as if it had already won uncontested.
- [x] **16.2 `intentFilled[intentId]` stays as-is — decided, not a gap.** Considered migrating it
      to a cache reconciled against `market.filledBy`, per the original plan. Concluded this is
      unnecessary: the market's own claim already runs first and is the actual authority (a second
      vault, or the same vault replaying, now gets `IntentAlreadyClaimed` from the market before
      ever reaching this mapping); the vault's own `intentFilled` continues to serve its real,
      vault-local purpose (`isFilled`/`advancedPrincipal` accounting) exactly as before, now simply
      redundant-but-harmless as a second replay guard — the same "two independent checks" pattern
      already established here for `ISettlementCheck`. No code change beyond 16.1 needed.
- [x] **16.3 `SettlementReceiver.settle()` reads `market.filledBy(intentId)`** instead of one
      hardcoded `IFillRegistry vault` reference, so it can reimburse whichever vault actually won,
      not a single fixed one. `initialize()` now takes `market_` in place of `vault_` (a real
      breaking change to this contract, fine — new deployment either way, no upgrade path exists).
      `IIntentMarket` extended with a `filledBy` view alongside `claimIntent`, bundled the same way
      `IFillRegistry` already bundles everything `SettlementReceiver` needs from a vault.
      `LpReimbursed` gained an `indexed vault` field for off-chain observability.
- [x] **16.4 Deploy wiring — the library half done, the standalone live-broadcast script not yet.**
      Both `ArcaidiaDeployment.deployAll` (fresh-from-scratch) and
      `deployReplacementVaultAndReceiver` (the V2-era redeploy path) now also deploy
      `ArcaidiaIntentMarket` and wire `vault.setMarket(...)` — new `MARKET_SALT`/`MARKET_V2_SALT`.
      Resolved the receiver/market circular dependency the same way both times: deploy the
      receiver's code without initializing (its own creation code takes no constructor args, so
      its address is fixed immediately), deploy the market against that now-known receiver
      address, then call `initialize` on the receiver with the market's address. Mirrored in
      `tests/e2e/src/deploy.ts` (the hand-written TS deploy harness) — same ordering, same
      circular-dependency fix. **Not done:** an actual `forge script` entrypoint for broadcasting
      this to a live chain — the deploy *logic* is tested and correct; nothing runs it against a
      real RPC yet. Needed before WP-20's live acceptance gate, not before.
- [x] **16.5 Regenerate ABIs.** `pnpm abi:generate` after the interface/contract changes.
      `ArcaidiaIntentMarket` was missing from `scripts/generate-abis.mjs`'s own contract list
      entirely (a gap from WP-15, only surfaced now) — added, 7 ABIs became 8. `abis.test.ts`
      extended with its own describe block, matching the existing per-contract pattern.

## Tests

- Full lifecycle with **two independently-deployed, independently-funded** vaults competing for
  one intent: exactly one fast-fills, `SettlementReceiver` reimburses that one, not the other.
- The House Vault's existing single-solver path still passes every WP-05/06 test unmodified —
  this WP must not change V1's observable behaviour when there is only one vault in the market.
- No double-pay: a fallback `settle()` after nobody fast-filled, then a late `fastFill` attempt,
  still reverts (WP-15.4's check exercised through the vault, not just the market directly).
- Reentrancy: a malicious vault implementation cannot claim, revert deliberately, and retry to
  extract a second win.

## Acceptance gate

Two mock vaults, same market, same `SettlementReceiver`: first-valid-fill is enforced end to end,
reimbursement reaches the correct winner, and every existing WP-02/05/06/10 contract test still
passes unmodified.

**Gate met 2026-09-11.** `test/IntentMarketVaultIntegration.t.sol` proves it end to end through
real `ArcaidiaLiquidityVault` and `SettlementReceiver` instances (not mocks): two independently-
deployed, independently-funded vaults race for one intent, exactly one wins, and canonical
settlement reimburses that one specifically — `vaultA` is left completely untouched when `vaultB`
wins. The fallback path (nobody fills) still pays the recipient directly with a market wired in.
Full monorepo regression green: domain 104, mcp 4, agent 269, settlement 132, contracts 299×2
(both directions), e2e 21 — 830 tests total, 0 failures. Two real downstream breaks found and
fixed while closing this out, both legitimate consequences of the `SettlementReceiver`/event
changes, not scope creep: `packages/settlement`'s `LpReimbursed` topic-selector decoding (hardcoded
event signature string, now stale) and the e2e deploy harness (never wired to a market at all,
so every real `fastFill` in that suite started reverting).
