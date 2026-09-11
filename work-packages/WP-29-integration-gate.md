# WP-29 — Local integration gate before any redeploy (M29)

**Objective:** the golden two-anvil harness runs the whole v2 economy: factory, heterogeneous
vaults, racing solvers, on-chain fee enforcement, hook-associated settlement, trade-intent
fallback. Nothing goes to testnet until this is green.

**Depends on:** WP-25–28. **Blocks:** WP-30, WP-31. **Stack:** `tests/e2e`.

## Sub-tasks

- [ ] **29.1 `deploy.ts` mirrors `deployAllV2`** (router v2, receiver v2, market, factory, House Vault via factory) — same salts as `ArcaidiaDeployment.sol`; `MockMessageTransmitterV2` local so `settleWithProof` runs end to end with mock attestations.
- [ ] **29.2 Harness: N vault/solver pairs** (`WorldOptions.vaults: [{policy, capital, signer}]`), each solver its own `SolverDependencies`.
- [ ] **29.3 Scenarios** (each in both directions):
      1. golden v2: intent → fill → `settleWithProof` → reimbursed (fee recognised in share price);
      2. race: two solvers, one intent, exactly one `FILLED`, the other `SUBMISSION_FAILED`/`SKIPPED`, settlement reimburses the winner;
      3. user ceiling: `maxFeeBps` below every vault's current tier → all `DECLINED FEE_CEILING_EXCEEDED` → fallback pays recipient via proof;
      4. utilisation ladder: successive intents push one vault through tiers; fees on chain match `FeePolicyLib`;
      5. exhaustion: liquidity exhausted → `INSUFFICIENT_LIQUIDITY` → CCTP fallback → reimbursement restores → next intent fills again;
      6. trade intent with no adapter → solver `TRADE_NOT_SUPPORTED` → fallback USDC to recipient; with `MockSwapAdapter` set → `DeliveredViaSwap`;
      7. hook association: tampered hook (other intent id) cannot settle; kill-the-relay re-run.
- [ ] **29.4 `tests/invariants` checklist** (README "Global invariants") + new: "no fill charges above the user's `maxFeeBps`", "no fill charges above the vault's posted fee", "trade intents never strand USDC".

## Acceptance gate

`pnpm test:global` green, `pnpm test:e2e` includes all seven scenarios in both directions. Only
now does WP-31 start.
