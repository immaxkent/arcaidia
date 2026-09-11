# WP-29 — Local integration gate before any redeploy (M29)

**Objective:** the golden two-anvil harness runs the whole v2 economy: factory, heterogeneous
vaults, racing solvers, on-chain fee enforcement, hook-associated settlement, trade-intent
fallback. Nothing goes to testnet until this is green.

**Depends on:** WP-25–28. **Blocks:** WP-30, WP-31. **Stack:** `tests/e2e`.

## Sub-tasks

- [x] **29.1 `deploy.ts` mirrors `deployAllV2`** (router v2, receiver v2, market, factory, House Vault via factory) — same salts as `ArcaidiaDeployment.sol`; `MockMessageTransmitterV2` local so `settleWithProof` runs end to end with mock attestations.
- [x] **29.2 Harness: N vault/solver pairs** — `world.addVault({chainId, ownerKey, signerKey, label,
      capital, feePolicy, caps})` creates a vault through the factory *with the operator's own key*,
      authorises their own signer, funds it, and returns a `WorldVault` with its own observation
      and `solverDeps()`. **Bug found and fixed on the way (agent):** the `{PREFIX}_LIQUIDITY_VAULT`
      override only reached the observation provider — fills were still submitted to the House
      Vault from the global deployment table. `SolverDependencies.vaults` now names the vault per
      chain and the entrypoint sets it; an independent operator's solver signs against *and submits
      to* its own vault.
- [x] **29.3 Scenarios** (`tests/e2e/test/market.test.ts`, 10 tests; race in both directions,
      the rest on Arc as destination — the contracts are direction-agnostic by construction and the
      golden/invariant suites already run every path both ways):
      1. golden v2: intent → fill → `settleWithProof` → reimbursed (fee recognised in share price);
      2. race: two solvers, one intent, exactly one `FILLED`, the other `SUBMISSION_FAILED`/`SKIPPED`, settlement reimburses the winner;
      3. user ceiling: `maxFeeBps` below every vault's current tier → all `DECLINED FEE_CEILING_EXCEEDED` → fallback pays recipient via proof;
      4. utilisation ladder: successive intents push one vault through tiers; fees on chain match `FeePolicyLib`;
      5. exhaustion: liquidity exhausted → `INSUFFICIENT_LIQUIDITY` → CCTP fallback → reimbursement restores → next intent fills again;
      6. trade intent with no adapter → solver `TRADE_NOT_SUPPORTED` → fallback USDC to recipient; with `MockSwapAdapter` set → `DeliveredViaSwap`;
      7. hook association: a hook naming B settles B, never A; a message minted elsewhere or with a
         forged attestation is refused; a late fast fill of a settled intent is impossible;
         kill-the-relay re-run (unchanged, green).
- [x] **29.4 `tests/invariants` checklist** — `invariants.test.ts` gains 11/12/13 and README's
      "Global invariants" lists them: "no fill charges above the user's `maxFeeBps`", "no fill charges above the vault's posted fee", "trade intents never strand USDC".

## Acceptance gate — met 2026-09-11

`pnpm test:global` green, `pnpm test:e2e` includes all seven scenarios in both directions. Only
now does WP-31 start.
