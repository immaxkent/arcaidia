# WP-16 — Vault integration with the market (M16)

**Objective:** `ArcaidiaLiquidityVault.fastFill()` claims through the market before doing anything
else, so winning a race and being allowed to pay are the same atomic event — never two steps a
reentrant or racing call could split apart.

**Depends on:** WP-15. **Blocks:** WP-17, WP-20. **Stack:** Foundry, `contracts/src`,
`contracts/script`.

## Sub-tasks

- [ ] **16.1 One new line in `fastFill`, before existing logic.**
      `market.claimIntent(auth.intentId, auth.outputAmount, auth.feeAmount);` — everything below it
      (allowlist check, replay, caps, transfer) is today's `fastFill`, unchanged. The external
      function signature does not change; nothing that imports its shape (frontend, domain
      package, solver) needs to change for this WP alone.
- [ ] **16.2 Migrate `intentFilled[intentId]`'s authority to the market.** The vault's own local
      mapping becomes a cache reconciled against `market.filledBy(intentId) != address(0)`, not the
      source of truth — a genuine implementation change, still not an ABI change.
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
