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
- [ ] **16.3 `SettlementReceiver.settle()` reads `market.filledBy(intentId)`** instead of one
      hardcoded `IFillRegistry vault` reference, so it can reimburse whichever vault actually won,
      not a single fixed one.
- [ ] **16.4 Deploy script.** `DeployIntentMarket.s.sol`: deploys `ArcaidiaIntentMarket`, points the
      existing vault(s) and `SettlementReceiver` at it. New addresses recorded in
      `packages/domain/src/config/deployments.ts` and this branch's own deployments note (not
      merged into the frozen V1 table in `README.md`).
- [ ] **16.5 Regenerate ABIs.** `pnpm abi:generate` after the interface/contract changes — the
      exact class of staleness caught during WP-13's regression.

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
