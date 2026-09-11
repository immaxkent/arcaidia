# WP-26 — Destination side: vault fee policy, on-chain maxFee, factory, receiver proof (M26)

**Objective:** the vault enforces the user's `maxFeeBps` and its own immutable fee policy; vaults
are created through a factory; canonical settlement is routed from Circle-attested bytes.

**Depends on:** WP-24 (WP-25 for the receiver's hook decode). **Blocks:** WP-27, WP-28, WP-29,
WP-30, WP-31, WP-34. **Stack:** Foundry. **Decisions:** D6, D7, D8, D9, D10.

## Sub-tasks

- [x] **26.1 `ArcaidiaLiquidityVault.initialize(owner, asset, reserveFloorBps, maxFillBps, maxExposureBps, FeePolicy policy)`.**
      Policy validated (`FeePolicyLib.validate`) and stored; no setter. `setFillLimits(maxFillBps, maxExposureBps)`
      loses `maxFeeBps`. Views: `feePolicy()`, `currentFeeBps()`, `quoteFee(uint256)`, `swapAdapter()`.
- [x] **26.2 `fastFill(Intent calldata intent, FillAuthorization calldata auth, bytes calldata sig)`.**
      New checks, in this order, before the existing ones: `market.claimIntent` (unchanged first
      line) → `IntentLib.computeIntentId(intent) == auth.intentId` (`IntentMismatch`) →
      `intent.intentVersion == INTENT_VERSION` → `intent.destinationChainId == block.chainid` →
      `intent.sourceChainId == auth.sourceChainId` → `intent.recipient == auth.recipient` →
      `intent.amount == auth.inputAmount` → `intent.deadline > block.timestamp` (`IntentExpired`) →
      `feeAmount <= amount * intent.maxFeeBps / 1e4` (`UserFeeCeilingExceeded`) →
      `feeAmount <= amount * currentFeeBps() / 1e4` (`FeeAbovePolicy`). Then today's expiry /
      amounts / caps / settlement-check / signer / nonce path unchanged. `FastFilled` v2 adds `feeBps`.
      `IArcaidiaSolverVault`: `quote(Intent) view returns (feeBps, feeAmount, outputAmount, canFill)`
      implemented for real. **Order as built:** the chain-independent authorization checks
      (paused, expiry, source ≠ this chain, amounts) run first, then `_enforceIntentTerms`
      (D6 id match, version, chain, terms, deadline, user ceiling, policy ceiling), then caps.
- [x] **26.3 Delivery seam (D9).** `setSwapAdapter(ISwapAdapter)` owner-only. In `_recordFastFill`:
      state first, then if `intent.tokenOut == 0 || swapAdapter == 0` → `safeTransfer(recipient, outputAmount)`;
      else `forceApprove(adapter, outputAmount)`; `try adapter.swapExactInput(asset, tokenOut, outputAmount, targetMinOut, recipient) returns (out)` →
      `DeliveredViaSwap(intentId, tokenOut, out)`; `catch` → approve 0, `safeTransfer(recipient, outputAmount)`,
      `SwapFellBack(intentId, tokenOut)`. `MockSwapAdapter` (success / revert / short-delivery modes) in `src/mocks`.
      Accounting is identical on both paths: `advancedPrincipal = outputAmount` in USDC.
- [x] **26.4 `ArcaidiaVaultFactory`** — and, found while designing 26.5, **the market now only
      admits factory-created vaults (D11)**: `ArcaidiaIntentMarket(settlementCheck, vaultRegistry)`,
      `NotAFactoryVault` otherwise. The factory embeds the vault's init code (20.7 KB runtime,
      3.9 KB under EIP-170 — the tightest contract; if the vault grows, switch to
      calldata-supplied init code pinned by hash). **`ArcaidiaVaultFactory`.** `initialize(owner, asset, market, settlementReceiver)` (CREATE2,
      no ctor args). `createVault(salt, reserveFloorBps, maxFillBps, maxExposureBps, FeePolicy, string label)`:
      CREATE2 the vault with `keccak256(msg.sender, salt)`, `initialize` with the factory as
      temporary owner, `setMarket`, `setSettlementReceiver`, `transferOwnership(msg.sender)`,
      emit `VaultCreated(vault, owner, label, policy, reserveFloorBps, maxFillBps, maxExposureBps)`.
      `predictVault(owner, salt)`. `vaultCount`, `isFactoryVault(address)`.
      Vault `initialize` remains callable by anyone-once (unchanged model) but the factory is the
      only path deployment tooling uses; the House Vault goes through it too.
- [x] **26.5 `SettlementReceiver` v2.** `initialize(owner, asset, market, messageTransmitter)`.
      `settleWithProof(bytes message, bytes attestation)` permissionless, `nonReentrant`: parse
      per D8 (`MessageV2` recipient @76 == this; body @148; `BurnMessageV2` mintRecipient @36 == this,
      amount @68, feeExecuted @164, hookData @228 → `IntentHookLib.decode`), require
      `outcomeOf[intentId] == NONE`, `balanceBefore`, `receiveMessage(message, attestation)` must
      return true, `minted = balanceAfter - balanceBefore == amount - feeExecuted`, then route:
      winner → `try recordReimbursement` (on revert: `outcome = HELD_FOR_VAULT`, `heldFor[intentId] = winner`,
      `claimHeld(intentId)` callable by that vault); else pay `recipient`. Reporter `settle` kept.
      `SettledWithProof(intentId, outcome, amount, nonce)`.
- [x] **26.6 `deployAll` *is* v2 now** (no separate `deployAllV2`: nothing on this branch will
      deploy the v1 shape again). Salts `arcaidia.v2.{intent-router, settlement-receiver,
      intent-market, vault-factory}` + House Vault at the factory under `arcaidia.v2.house-vault`
      salted by the deploying address. `deployReplacementVaultAndReceiver`/`DeployVaultV2.s.sol`
      (WP-12) deleted; `Deploy.s.sol` reads the fee tiers/caps/transmitter from env with the
      plan's House defaults. `ArcaidiaDeployment.deployAllV2` + `predictV2`.** Salts `arcaidia.v2.{intent-router,
      settlement-receiver, intent-market, vault-factory}`; House Vault via `factory.createVault`
      (salt `"house"`). `MARKET_V2` constructor arg = predicted receiver (same-address argument, D-note in file).
      `script/DeployV2.s.sol` (env-driven, prints predictions, asserts after). Not run yet.
- [x] **26.7 `pnpm abi:generate`** (+ `ArcaidiaVaultFactory`, `MockSwapAdapter`).

## Tests (the brief's list, mapped) — all green, both directions (365 contract tests)

- [x] maxFeeBps enforced by vault: `UserFeeCeilingExceeded` one wei over; equal passes (`FastFill.t.sol`, `VaultIntentTerms.t.sol`).
- [x] solver cannot overcharge: `FeeAbovePolicy` above the posted tier even under the user's ceiling.
- [x] fee tier changes with utilisation: 0/50/75/90% ladder + fuzz against `FeePolicyLib` at every utilisation.
- [x] intent id mismatch / inconsistent terms / expired intent / wrong chain all refused (`IntentMismatch`, `IntentTermsInconsistent`, `IntentExpired`).
- [x] insufficient liquidity cannot produce a fill (existing suite under the v2 signature).
- [x] two vault/solver pairs race one intent; only one wins (`IntentMarketVaultIntegration.t.sol`, intent-aware).
- [x] CCTP settlement restores capital from attested bytes: winner reimbursed, fallback pays the hook's recipient, `feeExecuted` honoured, `HELD_FOR_VAULT` → `retryHeld` (`SettlementReceiverProof.t.sol`).
- [x] metadata → correct intent: A's message cannot settle B; wrong `mintRecipient`, malformed hook, unaccepted attestation, replay, reused CCTP nonce, front-run `receiveMessage` all refused.
- [x] trade fields: no adapter → USDC; adapter → `DeliveredViaSwap`; unsatisfiable floor / broken adapter → USDC; plain transfers ignore the adapter; identical accounting on every path.
- [x] factory: predicted == deployed; creator-owned; wired; `VaultCreated` fields; per-creator salts; invalid policy refused; market admits factory vaults only (`VaultFactory.t.sol`).
- [x] invariants + rounding + reentrancy suites re-run under v2 (handler builds real intents).
- [x] TS consumers: `FillSubmitter` carries the intent (agent 322 tests); e2e deploys the v2 shape through the factory and runs the golden lifecycle (24 tests).

## Acceptance gate — met 2026-09-11

`pnpm test:sc-eth && pnpm test:sc-arc` green; `ArcaidiaDeployment.t.sol` proves `deployAllV2`
predicts and wires all five contracts + House Vault identically on both simulated chains.
