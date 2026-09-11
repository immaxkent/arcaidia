# WP-26 — Destination side: vault fee policy, on-chain maxFee, factory, receiver proof (M26)

**Objective:** the vault enforces the user's `maxFeeBps` and its own immutable fee policy; vaults
are created through a factory; canonical settlement is routed from Circle-attested bytes.

**Depends on:** WP-24 (WP-25 for the receiver's hook decode). **Blocks:** WP-27, WP-28, WP-29,
WP-30, WP-31, WP-34. **Stack:** Foundry. **Decisions:** D6, D7, D8, D9, D10.

## Sub-tasks

- [ ] **26.1 `ArcaidiaLiquidityVault.initialize(owner, asset, reserveFloorBps, maxFillBps, maxExposureBps, FeePolicy policy)`.**
      Policy validated (`FeePolicyLib.validate`) and stored; no setter. `setFillLimits(maxFillBps, maxExposureBps)`
      loses `maxFeeBps`. Views: `feePolicy()`, `currentFeeBps()`, `quoteFee(uint256)`, `swapAdapter()`.
- [ ] **26.2 `fastFill(Intent calldata intent, FillAuthorization calldata auth, bytes calldata sig)`.**
      New checks, in this order, before the existing ones: `market.claimIntent` (unchanged first
      line) → `IntentLib.computeIntentId(intent) == auth.intentId` (`IntentMismatch`) →
      `intent.intentVersion == INTENT_VERSION` → `intent.destinationChainId == block.chainid` →
      `intent.sourceChainId == auth.sourceChainId` → `intent.recipient == auth.recipient` →
      `intent.amount == auth.inputAmount` → `intent.deadline > block.timestamp` (`IntentExpired`) →
      `feeAmount <= amount * intent.maxFeeBps / 1e4` (`UserFeeCeilingExceeded`) →
      `feeAmount <= amount * currentFeeBps() / 1e4` (`FeeAbovePolicy`). Then today's expiry /
      amounts / caps / settlement-check / signer / nonce path unchanged. `FastFilled` v2 adds `feeBps`.
      `IArcaidiaSolverVault`: `quote(Intent) view returns (feeBps, feeAmount, outputAmount, canFill)`
      implemented for real.
- [ ] **26.3 Delivery seam (D9).** `setSwapAdapter(ISwapAdapter)` owner-only. In `_recordFastFill`:
      state first, then if `intent.tokenOut == 0 || swapAdapter == 0` → `safeTransfer(recipient, outputAmount)`;
      else `forceApprove(adapter, outputAmount)`; `try adapter.swapExactInput(asset, tokenOut, outputAmount, targetMinOut, recipient) returns (out)` →
      `DeliveredViaSwap(intentId, tokenOut, out)`; `catch` → approve 0, `safeTransfer(recipient, outputAmount)`,
      `SwapFellBack(intentId, tokenOut)`. `MockSwapAdapter` (success / revert / short-delivery modes) in `src/mocks`.
      Accounting is identical on both paths: `advancedPrincipal = outputAmount` in USDC.
- [ ] **26.4 `ArcaidiaVaultFactory`.** `initialize(owner, asset, market, settlementReceiver)` (CREATE2,
      no ctor args). `createVault(salt, reserveFloorBps, maxFillBps, maxExposureBps, FeePolicy, string label)`:
      CREATE2 the vault with `keccak256(msg.sender, salt)`, `initialize` with the factory as
      temporary owner, `setMarket`, `setSettlementReceiver`, `transferOwnership(msg.sender)`,
      emit `VaultCreated(vault, owner, label, policy, reserveFloorBps, maxFillBps, maxExposureBps)`.
      `predictVault(owner, salt)`. `vaultCount`, `isFactoryVault(address)`.
      Vault `initialize` remains callable by anyone-once (unchanged model) but the factory is the
      only path deployment tooling uses; the House Vault goes through it too.
- [ ] **26.5 `SettlementReceiver` v2.** `initialize(owner, asset, market, messageTransmitter)`.
      `settleWithProof(bytes message, bytes attestation)` permissionless, `nonReentrant`: parse
      per D8 (`MessageV2` recipient @76 == this; body @148; `BurnMessageV2` mintRecipient @36 == this,
      amount @68, feeExecuted @164, hookData @228 → `IntentHookLib.decode`), require
      `outcomeOf[intentId] == NONE`, `balanceBefore`, `receiveMessage(message, attestation)` must
      return true, `minted = balanceAfter - balanceBefore == amount - feeExecuted`, then route:
      winner → `try recordReimbursement` (on revert: `outcome = HELD_FOR_VAULT`, `heldFor[intentId] = winner`,
      `claimHeld(intentId)` callable by that vault); else pay `recipient`. Reporter `settle` kept.
      `SettledWithProof(intentId, outcome, amount, nonce)`.
- [ ] **26.6 `ArcaidiaDeployment.deployAllV2` + `predictV2`.** Salts `arcaidia.v2.{intent-router,
      settlement-receiver, intent-market, vault-factory}`; House Vault via `factory.createVault`
      (salt `"house"`). `MARKET_V2` constructor arg = predicted receiver (same-address argument, D-note in file).
      `script/DeployV2.s.sol` (env-driven, prints predictions, asserts after). Not run yet.
- [ ] **26.7 `pnpm abi:generate`** (+ `ArcaidiaVaultFactory`, `MockSwapAdapter`).

## Tests (the brief's list, mapped)

- [ ] maxFeeBps enforced by vault: fee one wei over `amount*maxFeeBps/1e4` reverts; equal passes.
- [ ] solver cannot overcharge: `feeAmount` above `currentFeeBps()` reverts even when under user ceiling.
- [ ] fee tier changes with utilisation: deposit, fill to 50/75/90%, `currentFeeBps` steps; fuzz over utilisation.
- [ ] intent id mismatch: any single-field tamper of `intent` vs `auth.intentId` reverts (`IntentMismatch`).
- [ ] insufficient liquidity cannot produce a fill (existing, re-run under v2 signature).
- [ ] two vault/solver pairs with **different policies** race one intent; only one wins;
      the loser gets `IntentAlreadyClaimed` (`IntentMarketVaultIntegration.t.sol` ported).
- [ ] CCTP settlement restores capital: `settleWithProof` with a mock-transmitter message
      (attestation accepted by `MockMessageTransmitterV2`) reimburses the winner; fallback pays recipient;
      `HELD_FOR_VAULT` when reimbursement reverts, then `claimHeld` succeeds.
- [ ] metadata → correct intent: message whose hook names intent A cannot settle intent B; wrong
      `mintRecipient` reverts; replay reverts (`AlreadySettled`).
- [ ] trade fields: `tokenOut != 0` with no adapter → USDC to recipient; with `MockSwapAdapter`
      success → `DeliveredViaSwap`; adapter revert → `SwapFellBack` and USDC delivered; vault
      accounting identical in all three.
- [ ] factory: predicted == deployed; owner is `msg.sender`; wired to market/receiver; `VaultCreated`
      fields; second vault, different policy; a non-factory vault can still `fastFill` (permissionless).
- [ ] invariants (`VaultInvariants.t.sol`) + rounding + reentrancy suites re-run.

## Acceptance gate

`pnpm test:sc-eth && pnpm test:sc-arc` green; `ArcaidiaDeployment.t.sol` proves `deployAllV2`
predicts and wires all five contracts + House Vault identically on both simulated chains.
