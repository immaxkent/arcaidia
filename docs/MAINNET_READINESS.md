# Arcaidia — Mainnet Readiness Audit (Arc Mainnet ↔ Ethereum Mainnet)

| | |
|---|---|
| **Prepared** | 2026-09-16 |
| **Code audited** | branch `v4-uniswap` at `e71bb5b`, plus `contracts/test/MainnetReadinessPoC.t.sol` (added by this audit) |
| **Contracts in scope** | `ArcaidiaIntentRouter`, `ArcaidiaVaultFactory`, `ArcaidiaLiquidityVault`, `ArcaidiaIntentMarket`, `SettlementReceiver`, `CircleCCTPInitiator`, `UniswapV2SwapAdapter`, `ArcaidiaDeployer`, `ArcaidiaDeployment`, all libraries and deploy scripts |
| **Off-chain in scope** | `packages/domain`, `packages/agent` (reference solver), `packages/settlement`, `packages/relay`, `packages/x402-gateway`, `packages/loadgen`, `apps/web`, `subgraph/`, `scripts/`, `deploy/` |
| **Nothing was deployed.** | No mainnet transaction was sent. Mainnet was only read (`eth_chainId`, `eth_getCode`, `eth_call`). |

**Evidence markers used throughout**

- ✅ **chain** — read directly from the named chain on 2026-09-16.
- 📄 **docs** — taken from the official source named beside it on 2026-09-16. Re-check on deploy day.
- 🧪 **test** — reproduced by a Foundry test in this repository (`forge test --match-contract MainnetReadinessPoC`).
- ⚠️ **assumption** — not verified. Listed again in section J.

Decisions recorded 2026-09-16: the launch route is **Ethereum Mainnet ↔ Arc Mainnet**. Pausing stays an owner action through the Safe, with no separate guardian role for now. Trade intents, the Uniswap adapter and Hedera intelligence are off at launch. The fix plan and post-launch milestones are in [`work-packages/MAINNET-PLAN.md`](../work-packages/MAINNET-PLAN.md).

---

## A. Executive status — 🔴 RED

**SAFE TO DEPLOY: NO.**

The market model is sound and most of its safety properties hold under review: single fill per intent, EIP-712 domain separation, user fee ceilings, ERC-4626 rounding and inflation defence, reentrancy, and exact-mint checks. Twelve proof-of-concept tests nonetheless reproduce defects in the current contracts, and two of them are critical loss-of-funds issues. One of those already caused a real double payment on Arc Testnet.

| Severity | Count | Loss of funds | Availability / UX |
|---|---|---|---|
| Critical | 2 | 2 | 0 |
| High | 6 | 6 | 0 |
| Medium | 6 | 3 | 3 |
| Low | 7 | 2 | 5 |

The existing suite passes before and after this audit's additions: **406 tests pass in both directions** (`forge test`, and `ARCAIDIA_SOURCE=arc forge test`).

---

## B. Blocking issues

Mainnet is blocked until every item below is closed with the evidence named in its row.

| # | Blocker | Finding | Closed when |
|---|---|---|---|
| B-1 | Anyone can lock the canonical settlement of any in-flight intent by burning 1 micro-USDC through CCTP with a forged hook | C-01 | Receiver authenticates the burn's source; initiator only serves the router; both PoCs inverted and passing |
| B-2 | Stale receiver references allow double payment (the known issue) | C-02 | Fresh, atomically wired set; vault refuses to fill when its receiver differs from the market's; PoC inverted |
| B-3 | Deployment can be front-run or squatted at the predicted addresses | C-03 | Receiver initialised atomically; deployer restricted; scripts verify the far chain before `setDestination` |
| B-4 | Reporter recovery path can block settlement and redirect parked funds | C-04 | `settle()` removed from the mainnet receiver, or restricted as specified; PoCs inverted |
| B-5 | Solver advances capital after 1 confirmation on Ethereum | C-05 | Per-chain finality policy; Ethereum-sourced intents require a finalized source block |
| B-6 | Deploy scripts silently fall back to testnet Circle and USDC addresses | C-06 | Per-chain manifest with no defaults; scripts revert on unknown chain; post-deploy assertions read CCTP state |
| B-7 | One EOA holds every protocol role | C-07 | Protocol owner is a Safe on each chain; roles separated per section E.3 |
| B-8 | Production configuration still compiles in testnet chains, the hackathon indexer, loadgen and demo identities | C-14, D.3 | Mainnet profile exists, has no testnet chain IDs, and CI enforces it |
| B-9 | No re-attestation path and no in-flight release automation | C-11, C-13 | Worker re-attests expired messages; in-flight capacity released automatically or the cap redesigned |

### B-0. Known issue — the market's immutable receiver reference

**Question 1. Why did this happen?**
The receiver was replaced in isolation. The v2.0 receiver (`0x8B93b54d6Df61E9422D14C309F3c9Ab950b920Cd`) wrongly required the CCTP header `recipient` to be itself, so it refused every genuine message. Decision **D12** (`work-packages/DECISIONS.md`) deployed v2.1 (`0xa60c586E4d050233885cD6628B7C1A217574d9c6`) through `contracts/script/RedeployReceiver.s.sol` and re-pointed only the owner-settable references. The rest of the protocol was not redeployed.

Two references could not be re-pointed:

- `ArcaidiaIntentMarket.settlementCheck` is `immutable` and set in the constructor ([ArcaidiaIntentMarket.sol:66](../contracts/src/ArcaidiaIntentMarket.sol)).
- `ArcaidiaVaultFactory.settlementReceiver` is written once in `initialize` and has no setter ([ArcaidiaVaultFactory.sol:34](../contracts/src/ArcaidiaVaultFactory.sol)). Every vault the factory creates is wired to it ([ArcaidiaVaultFactory.sol:104](../contracts/src/ArcaidiaVaultFactory.sol)).

D12 recorded the market reference as "harmless" because it "only reads an already-settled flag". That reasoning missed that this read is the only late-fill guard that does not depend on each vault owner's configuration.

The deployment design also makes the circularity structural. The market's init code embeds the receiver address, and the receiver's `initialize` takes the market address ([ArcaidiaDeployment.sol](../contracts/src/deploy/ArcaidiaDeployment.sol), `deployAll`). Replacing one without the other always leaves a stale edge.

**Question 2. Does it affect live testnet behaviour? Yes, with a proven loss.**

✅ chain, both testnets, 2026-09-16:

| Reference | Sepolia | Arc Testnet |
|---|---|---|
| `market.settlementCheck()` | `0x8B93…20Cd` (retired) | `0x8B93…20Cd` (retired) |
| `factory.settlementReceiver()` | `0x8B93…20Cd` (retired) | `0x8B93…20Cd` (retired) |
| `r2.market()` | current market ✓ | current market ✓ |
| `router.destinationReceiver(other)` | `0xa60c…d9c6` ✓ | `0xa60c…d9c6` ✓ |
| Factory vaults with receiver = r2 | 4 of 4 | 5 of 5 |

All nine current vaults have since been re-pointed by hand, but each one was created pointing at the retired receiver.

The double payment is on Arc Testnet, intent `0xd2773113d80a456c69a9049ea4ef6e40fb0697a586cd048f1e1e56b12c8ab3ca`:

| Step | Block | Transaction |
|---|---|---|
| Live receiver pays the recipient by fallback | 61838479 | `0x8ac80983ad135f653631e959df7cecf4051baf115c1f84c9b7c051ebe24525b4` |
| Vault `0x180d1c22…E5Ae` fast-fills the same intent | 61838502 | `0x0c1264041dd5a558ab7a44faf7608539c19be90fe3fbe0eecf61df6435079261` |

Archive state at both blocks shows `vault.settlementReceiver() = 0x8B93…20Cd`, the retired receiver. Current state shows `r2.outcomeOf(id) = 2` (RECIPIENT_FALLBACK), `market.filledBy(id)` = that vault, and `vault.advancedPrincipal(id) = 3,778,110`. The recipient was paid twice. That vault carries a 3.778110 USDC receivable that can never be reimbursed, and its `totalAssets()` still counts it, so its share price is overstated.

The same vault also produced five `HeldForVault` events in the same window, later released by `retryHeld` once its owner re-pointed it. That confirms the vault was mis-wired, not just slow.

**Question 3. Intentional or stale? Stale.** The market holds one `ISettlementCheck` by design ("one settlement source of truth per chain"). A market reading a receiver that no longer settles anything contradicts that design.

**Question 4. What is the correct production relationship?** One bidirectional binding per chain, checked on chain at deploy time and enforced at fill time:

```
receiver.market()            == market
market.settlementCheck()     == receiver
market.vaultRegistry()       == factory
factory.market()             == market
factory.settlementReceiver() == receiver
vault.market()               == market            (for every vault that fills)
vault.settlementReceiver()   == market.settlementCheck()   (enforced in fastFill)
```

Operating rule: a receiver is never replaced alone. A receiver, market and factory are one unit, redeployed and wired together.

**Question 5. What tests prove the fix?**

- 🧪 `test_PoC_staleReceiverWiring_allowsDoublePayment` reproduces the testnet sequence exactly. After the fix it must be inverted: a vault whose receiver differs from `market.settlementCheck()` cannot fill.
- 🧪 `test_Fix_marketBoundToLiveReceiverRefusesLateClaimRegardlessOfVaultWiring` shows the market alone stops the late fill once it is bound to the live receiver, even with the vault's own pointer left stale.
- 🧪 `testFuzz_Fix_noClaimAfterLiveSettlement` checks that, for any intent id and amount settled by the live receiver, no factory vault can claim it.
- To add with the fix: a deployment test asserting all seven equalities above for `deployAll` on both directions, and a fuzz test that `fastFill` reverts whenever `vault.settlementReceiver() != market.settlementCheck()`.

**Question 6. Other equivalent stale dependencies**

| Dependency | Mutable? | State | Verdict |
|---|---|---|---|
| `factory.settlementReceiver` | No setter | Retired receiver on both testnets | **Stale.** Every new testnet vault is born vulnerable until its owner re-points it. |
| `vault.settlementReceiver` | Owner | All 9 correct now; 1 proven wrong at fill time | Mutable per vault, so it can drift again. Needs the fill-time equality check. |
| `router.settlementInitiator` | No setter | Current initiator ✓ | Correct. Replacing the initiator means replacing the router (WP-10 precedent). |
| `CircleCCTPInitiator.tokenMessenger` | Immutable | Testnet messenger ✓ | Correct on testnet. Must be the mainnet address at construction. |
| `SettlementReceiver.messageTransmitter` | Set once in `initialize` | Testnet transmitter ✓ | Correct on testnet. A wrong value on mainnet makes every settlement unreceivable (C-06). |
| `UniswapV2SwapAdapter.router` | Immutable | Testnet fork router `0x000b7729…9D1b` | Correct for testnet. Mainnet needs a new adapter per chain. |
| Off-chain `RETIRED_SETTLEMENT_RECEIVERS` | Config | Probed deliberately | Intentional history, not stale. |
| Subgraph and Nest receiver data source | Config | Live receiver ✓ | Correct. |
| `CreateVault.s.sol` `DEFAULT_FACTORY`, `RedeployReceiver.s.sol` constants, `scripts/recover-*.sh` | Code | Testnet addresses | Testnet-only tooling. Must not be reachable from a mainnet run (C-06). |

---

## C. Security findings

Each finding states its class. **Loss of funds** means value can be taken, destroyed or made permanently unreachable. **Availability / UX** means the protocol stops or degrades but value stays recoverable.

### Critical

#### C-01 — Settlement accepts any CCTP burn that names an intent id in its hook

- **Class:** Loss of funds, for users and LPs.
- **Where:** [SettlementReceiver.sol:148-177](../contracts/src/SettlementReceiver.sol), [CircleCCTPInitiator.sol:115-157](../contracts/src/CircleCCTPInitiator.sol), [CctpMessageLib.sol](../contracts/src/libraries/CctpMessageLib.sol).
- **Evidence:** 🧪 `test_PoC_spoofedHookLocksAnUnfilledIntentForOneMicroUsdc`, 🧪 `test_PoC_spoofedHookStrandsAFilledVaultsPrincipal`, 🧪 `test_PoC_initiatorAcceptsAnyCallerAndAnyHook`. ✅ chain: the live receiver's runtime bytecode on both testnets hashes to `0x978b3ed9…b548`, identical to this source.

`settleWithProof` checks that the message mints to this receiver and that the intent id is not yet settled. It never checks who made the burn. `CctpMessageLib` does not parse the burn body's `messageSender` (offset 100) or the header's `sourceDomain` (offset 4). On a real network anyone can call `TokenMessengerV2.depositForBurnWithHook` with any amount, `mintRecipient` and `destinationCaller` set to the receiver, and any `hookData`, and Circle will attest it. `CircleCCTPInitiator.initiateSettlement` also has no caller restriction, so a burn can even carry the protocol initiator as `messageSender`.

Attack, for about 0.000001 USDC plus gas:

1. Watch for `IntentCreated` on the source chain.
2. Burn 1 unit through CCTP with `hookData = encode(victimIntentId, attacker)`.
3. Call `settleWithProof` with the attacker's attested message. The settlement worker waits 25 minutes by default, so the attacker's message arrives first.

Outcome if the victim was not yet filled: the receiver records RECIPIENT_FALLBACK and pays the attacker 1 unit. Every solver is then blocked from filling. The user's genuine message reverts `AlreadySettled`, and because it names the receiver as `destinationCaller`, nobody else can receive it. **The user's full principal is permanently unreachable.**

Outcome if the victim was filled: the 1-unit amount is below principal, so reimbursement reverts and funds park as HELD_FOR_VAULT with `settledAmount = 1`. `retryHeld` can never succeed and the genuine message is refused. **The LP's principal is permanently lost.**

**Fix, preserving the model:**

1. `CircleCCTPInitiator` accepts calls only from its router. The router's CREATE2 address is known before the initiator is constructed, so it can be an immutable constructor argument.
2. `CctpMessageLib.parse` also returns `sourceDomain` and `messageSender`.
3. `SettlementReceiver` holds an owner-set, set-once mapping `sourceDomain → trusted initiator` and reverts `UntrustedSource` unless `messageSender` matches. The real golden vector in `SettlementReceiverProof.t.sol` already confirms the offset: its body word at offset 100 is `0x6095944456c20a0acf7c44e4ff40dea8f041d9b3`, the Arc Testnet initiator, and its `sourceDomain` is 26.

**Tests that prove the fix:** invert the two spoofed-hook PoCs so they expect `UntrustedSource`. Invert the initiator PoC so it expects `NotRouter`. Add a fuzz test over random `messageSender` and `sourceDomain` asserting that only the configured pair settles. Add a fork test that performs a real `depositForBurnWithHook` through the router on an Ethereum mainnet fork and parses the emitted `MessageSent` bytes.

#### C-02 — Stale receiver references allow double payment

- **Class:** Loss of funds, for LPs.
- **Evidence:** section B-0; 🧪 `test_PoC_staleReceiverWiring_allowsDoublePayment`; ✅ chain testnet transactions above.
- **Fix:**
  1. Mainnet deploys receiver, market and factory together with the atomic wiring in section E, so no stale edge exists at launch.
  2. `ArcaidiaLiquidityVault.fastFill` reverts `ReceiverMismatch` unless `settlementReceiver == IIntentMarket(market).settlementCheck()`. The market must expose that getter through the `IIntentMarket` interface. A mis-wired vault then fails closed and never creates a receivable nobody can reimburse.
  3. Runbook rule: replace receiver, market and factory together or not at all.
- **Tests:** B-0 question 5.
- **Testnet remediation, not blocking mainnet:** vault `0x180d1c22…E5Ae` carries a phantom 3.778110 USDC receivable. The testnet factory still wires the retired receiver into every new vault.

### High

#### C-03 — Deployment can be front-run, and predicted addresses can be squatted

- **Class:** Loss of funds, through a compromised deployment.
- **Where:** [ArcaidiaDeployment.sol](../contracts/src/deploy/ArcaidiaDeployment.sol) `deployAll`, [ArcaidiaDeployer.sol:39-60](../contracts/src/deploy/ArcaidiaDeployer.sol), [RedeployReceiver.s.sol:59-63](../contracts/script/RedeployReceiver.s.sol), [Deploy.s.sol](../contracts/script/Deploy.s.sol).
- **Evidence:** 🧪 `test_PoC_receiverInitializeIsFrontRunnable`, 🧪 `test_PoC_anyoneCanOccupyTheCanonicalRouterAddress`.

Three weaknesses combine here.

- The receiver is deployed with an empty init call. Under `forge script --broadcast` its `initialize` is a separate transaction that anyone may call first.
- `ArcaidiaDeployer.deploy` is permissionless and the salts are public. Anyone can occupy a predicted router, receiver, market or factory address with their own initialisation.
- The script sets `router.setDestination(otherChain, predictedReceiver)` before the other chain has been deployed or checked.

If an attacker occupies the receiver's predicted address on chain B before B is deployed, chain A's router burns every user's USDC to a receiver the attacker initialised, pointing at a market the attacker controls.

**Fix:**

- Deploy the receiver with `initialize(owner, usdc, predictedMarket, messageTransmitter)` as its init call. `initialize` does not call the market, so the predicted address is enough.
- Restrict `ArcaidiaDeployer.deploy` to an owner fixed at its construction, or namespace every salt with `msg.sender`.
- Deploy both chains, verify both with the section G assertions, and only then call `setDestination` on either router.
- Use new mainnet salts, for example `arcaidia.mainnet.v1.*`.

**Tests:** invert both PoCs. Add a deployment test showing `deployAll` leaves no uninitialised contract between calls, by asserting `initialized()` immediately after each `deploy`.

#### C-04 — The reporter recovery path can block settlement and redirect parked funds

- **Class:** Loss of funds, if the reporter key is compromised or misused.
- **Where:** [SettlementReceiver.sol:202-217](../contracts/src/SettlementReceiver.sol).
- **Evidence:** 🧪 `test_PoC_reporterCanPermanentlyBlockGenuineSettlement`, 🧪 `test_PoC_reporterCanRedirectParkedFunds`. ✅ chain: the only reporter on the live testnet receiver is the protocol owner EOA `0x538e…65b0`. The worker key `0x1BBC…9862` is not a reporter.

`settle(intentId, fallbackRecipient, amount)` needs only `amount ≤ receiver balance`. With 1 unit donated by anyone, a reporter can mark any pending intent settled. Its genuine message is then unreceivable, which is the same lock as C-01. When funds are parked for a vault, the reporter can instead settle a made-up intent id and send those parked funds to any address.

The v2 router never produces hookless burns, so mainnet has no legitimate use for this path.

**Fix:** remove `settle()` and the reporter role from the mainnet receiver. If a recovery valve is still wanted, restrict it to the owner Safe and to intents whose CCTP nonce is already consumed, and route only to `market.filledBy(intentId)`. **Tests:** invert both PoCs, or delete them together with the function.

#### C-05 — The solver advances capital after one source confirmation

- **Class:** Loss of funds, for LPs.
- **Where:** [packages/agent/src/risk/default-policy.ts:29-41](../packages/agent/src/risk/default-policy.ts).

All three amount tiers require 1 confirmation, a choice commented as "for demo speed". On Ethereum a block can be reorganised out. If the source transaction disappears, no burn exists and the fill is never reimbursed. Arc finalises on inclusion (📄 Arc EVM compatibility page), so 1 confirmation is correct for Arc-sourced intents only.

**Fix:** make confirmation policy per source chain. For Ethereum-sourced intents, require the source block to be at or below the `finalized` block tag before signing. The expected wait is about two epochs, roughly 13 minutes (⚠️ Ethereum protocol behaviour, not Circle documentation). Fast fills from Ethereum then arrive after finality but still well ahead of attestation and settlement. Keep 1 for Arc. **Tests:** a unit test that an Ethereum intent above `finalized` yields a REJECT with a confirmation reason, and that an Arc intent does not.

#### C-06 — Deploy scripts silently fall back to testnet Circle and USDC addresses

- **Class:** Loss of funds, through misconfiguration.
- **Where:** [Deploy.s.sol](../contracts/script/Deploy.s.sol): `CCTP_V2_TOKEN_MESSENGER`, `CCTP_V2_MESSAGE_TRANSMITTER`, `_defaultSettlementAsset`, and `vm.envOr(..., testnetDefault)`. Also [DeployCctpRouter.s.sol](../contracts/script/DeployCctpRouter.s.sol) and [RedeployReceiver.s.sol](../contracts/script/RedeployReceiver.s.sol).

✅ chain: the testnet TokenMessenger `0x8FE6…2DAA` and MessageTransmitter `0xE737…E275` have **no code** on Arc Mainnet. A receiver initialised with the testnet transmitter accepts the address, because `initialize` only rejects zero. Every `receiveMessage` call would then revert. Since the router names that receiver as `destinationCaller`, every canonical burn to it would be unreachable. This is the D12 failure class again.

**Fix:** one committed per-chain manifest, `contracts/deploy/mainnet.json`, holding only values marked ✅ in section D. Scripts revert on any chain id not in the manifest, and use `vm.envAddress` with no defaults. Post-deploy assertions read `MessageTransmitterV2.localDomain()`, `TokenMessengerV2.localMessageTransmitter()`, `remoteTokenMessengers(otherDomain)` and USDC `decimals()`/`symbol()` and compare them to the manifest.

#### C-07 — One externally owned account holds every protocol role

- **Class:** Loss of funds, if that key is compromised.
- **Evidence:** ✅ chain, both testnets. `0x538e5E9797fa86eE25e97289439b6A3AbA0165b0` owns the router, factory, receiver, both initiators, the House Vault and both swap adapters. It is also the House Vault treasury and the only reporter.

What that one key can do today:

| Power | Consequence |
|---|---|
| `router.setDestination` | Redirects the canonical settlement of every new intent to any address. Solvers still fill, so LP principal and unfilled user principal are both lost. |
| `initiator.setDomain` / `setFinality` | Burns to the wrong domain, or pays fees up to any `maxFee`. |
| `receiver.setReporter` | Enables the C-04 attacks. |
| `router.setPaused` / `setLimits` | Halts intake. |
| House Vault owner | Sets signers, caps and adapter, which leads to C-08. |

**Fix:** a Safe multisig owns protocol contracts on each chain. Safe v1.4.1 is listed as canonical for chain 5042 in `safe-global/safe-deployments` (📄), and `SafeL2 0x29fcB43b…C762`, `SafeProxyFactory 0x4e1DCf7A…ec67` and `CompatibilityFallbackHandler 0xfd0732Dc…Ec99` have code on Arc Mainnet (✅ chain). The threat mitigated is concrete: a single laptop or keystore compromise would otherwise let one signature redirect all canonical USDC. Add a two-step `transferOwnership` (C-20) before handing ownership to a Safe.

#### C-08 — A vault's owner and signer can spend that vault's LP capital

- **Class:** Loss of funds, for LPs of that vault. This is inherent to the operator-run vault model.
- **Where:** [ArcaidiaLiquidityVault.sol:309-341, 661-728](../contracts/src/ArcaidiaLiquidityVault.sol).

The vault verifies that an `Intent` hashes to the authorised id, but it cannot see the source chain, so it cannot know whether that intent was ever created. An authorised signer can therefore sign fills for fabricated intents paying any recipient. Each fill is bounded by `maxFillBps`, and the total by `maxExposureBps`, which is 80% on the House Vault. The owner can raise both to 100%, set the reserve floor to 0, add a signer, or set a swap adapter that keeps the user's USDC. Every change takes effect immediately.

This is consistent with CLAUDE.md rule 3: LP funds move only after the solver verifies the source receipt. It also means an LP in a third-party vault is fully trusting that operator.

**Fix for launch, no contract change:**

- The House Vault signer stays in a Circle developer-controlled wallet (MPC), never a raw key.
- The House Vault owner is the Safe.
- Launch caps stay small (section H).
- The UI does not accept third-party LP deposits until the disclosure below ships.

**Recommended, contract change:** a delay on `setAuthorisedSigner(…, true)`, `setFillLimits` increases, `setReserveFloorBps` decreases, `setSwapAdapter`, `setMarket` and `setSettlementReceiver`, so LPs can exit before a change applies. Withdrawals are not pausable today, which makes a delay effective.

**Disclosure:** state on `/earn` that a vault's operator controls up to `maxExposureBps` of deposits.

### Medium

#### C-09 — A blocklisted fallback recipient locks canonical funds

- **Class:** Loss of funds as a permanent lock, for that user.
- **Evidence:** 🧪 `test_PoC_blocklistedFallbackRecipientLocksCanonicalFunds`. 📄 Arc EVM compatibility page: "a value transfer to or from a blocklisted address reverts."

`_route`'s fallback `safeTransfer` reverts, so the whole `settleWithProof` reverts, including the mint. The message names the receiver as `destinationCaller`, so no other path exists. The fast-fill path also reverts for that recipient.

**Fix:** attempt the fallback transfer with a low-level call. On failure, record `HELD_FOR_RECIPIENT` with a permissionless `retryHeldRecipient(intentId)` that only ever pays the attested recipient. **Test:** invert the PoC. The message must be accepted and funds parked, then paid once the block is lifted.

#### C-10 — Parked reimbursements have no terminal path

- **Class:** Loss of funds as a permanent lock, for LPs.
- **Where:** [SettlementReceiver.sol:180-192](../contracts/src/SettlementReceiver.sol), [ArcaidiaLiquidityVault.sol:836-857](../contracts/src/ArcaidiaLiquidityVault.sol).

If a winner's `recordReimbursement` reverts permanently, `retryHeld` reverts forever. Two causes exist: an amount below principal, which C-01 can force and a future CCTP fee could cause, or a vault whose receiver pointer changed. The funds sit in the receiver and the vault keeps a receivable its share price counts.

**Fix:** let `recordReimbursement` accept `amount < principal`. It clears the principal, books the shortfall as a realised loss event, and reprices shares honestly. **Test:** a fuzz test over `amount ∈ [0, principal]` asserting exposure clears, `totalAssets` falls by exactly the shortfall, and `retryHeld` succeeds.

#### C-11 — Router in-flight capacity only grows

- **Class:** Availability.
- **Where:** [ArcaidiaIntentRouter.sol:223-228, 269-270](../contracts/src/ArcaidiaIntentRouter.sol).
- **Evidence:** 🧪 `test_PoC_inFlightCapacityOnlyGrows`. ✅ chain: `totalInFlight` is 12,764.7 USDC on Sepolia and 12,551.5 USDC on Arc Testnet against a 200,000 USDC cap. No code in the repository calls `releaseInFlight`.

`createIntent` adds to `totalInFlight`, and only an owner transaction subtracts. At mainnet volume the router halts once cumulative volume reaches the cap.

**Fix, preserving the valve:** a keeper that watches `SettledWithProof` on the destination and calls `releaseInFlight(intentId, amount)` on the source, from the Safe or a dedicated role. The alternative contract change is a rolling-window cap. **Test:** an integration test that N intents above the cap succeed when each is released after its settlement.

#### C-12 — The solver does not verify the CCTP burn in the source receipt

- **Class:** Loss of funds, through router misconfiguration or owner compromise.
- **Where:** [packages/agent/src/verification/verify-source.ts](../packages/agent/src/verification/verify-source.ts).

Verification checks the router address, the `IntentCreated` fields, the asset, the route and the deadline. It never decodes TokenMessengerV2's `DepositForBurn` in the same receipt. A router whose destination was set wrongly, whether by accident or through C-07, still produces valid-looking intents, and every solver fills intents that can never reimburse them.

**Fix:** decode `DepositForBurn` and require `mintRecipient == destinationCaller == live destination receiver`, `destinationDomain` equal to the destination's domain, `amount == intent.amount`, `burnToken` equal to source USDC, and `hookData == encode(intentId, recipient)`. **Test:** unit tests with a receipt missing the burn, and with each field altered.

#### C-13 — No re-attestation when a message expires

- **Class:** Availability.
- **Where:** `packages/settlement`. No reference to `reattest` or `expirationBlock` exists.

📄 Circle CCTP technical guide: an expiration block about 24 hours ahead is encoded before signing, and an expired burn "must be re-signed" through `POST /v2/reattest/{nonce}`. A worker outage longer than that would leave settlements failing until someone intervenes by hand.

**Fix:** on an expiry revert, call re-attest, poll, and resubmit. **Test:** an adapter test with a stubbed Iris response.

#### C-14 — Market observation defaults to a hackathon host

- **Class:** Availability.
- **Where:** [packages/domain/src/config/chains.ts](../packages/domain/src/config/chains.ts), [apps/web/src/lib/arcaidia/config.ts:82-83](../apps/web/src/lib/arcaidia/config.ts), `scripts/recover-*.sh`. All default to `https://hackathon.89.167.109.4.sslip.io`.

The solvers' intent discovery, the web app and the recovery scripts depend on a shared hackathon indexer outside the team's control. It was already the cause of one multi-hour outage when its 16 KB query cap was hit.

**Fix:** a production subgraph per chain on The Graph using network ids `arc` and `mainnet` (📄 The Graph supported-networks page for Arc), or a self-run Nest, set only through required environment variables. A bounded RPC log scan in the solver serves as fallback discovery.

### Low

| ID | Finding | Class | Fix |
|---|---|---|---|
| C-15 | Mocks such as `MockUSDC` with public `mint` live in `contracts/src/mocks` and compile into production artifacts | Loss of funds only if deployed by mistake | Move to `contracts/test/mocks`; add a CI check that no script imports them |
| C-16 | `CircleCCTPInitiator.maxFee` is 0. Standard transfers cost 0 bps on Arc and Ethereum today and no fee switch is listed for either (📄 CCTP fees), but "Fees can change at any time" | Availability: `createIntent` would revert | Alert on the fee endpoint; runbook step to raise `maxFee` via Safe; C-10 handles any resulting shortfall |
| C-17 | A relayer can submit `fastFill` with just enough gas that the adapter call fails under the 63/64 rule, forcing USDC delivery instead of `tokenOut` | UX, value preserved | Only the House submitter relays at launch; or require a minimum gas left before the adapter call |
| C-18 | An LP can move a vault's fee tier by depositing or withdrawing | UX, bounded by the user's `maxFeeBps` and 150 bps | Accept and document |
| C-19 | The shared `UniswapV2SwapAdapter` is owned by the protocol but set on third-party vaults | Availability of trade delivery | Per-operator adapters, or document that the protocol may disable pairs |
| C-20 | `transferOwnership` is single-step on every contract; a mistyped address permanently removes admin, including pause | Availability | Two-step ownership (`pendingOwner` / `acceptOwnership`) |
| C-21 | `setDomain` accepts any domain; a wrong value burns to the wrong chain | Loss of funds through operator error | Set-once per destination; deploy assertion against `remoteTokenMessengers(domain) != 0` |

### Reviewed and holding

These threats were checked and the current design handles them. They need no change beyond the fixes above.

| Threat | Why it holds |
|---|---|
| Double fast fill | `market.filledBy` is written atomically within `fastFill`, and each vault also keeps `intentFilled` (`test_onlyOneOfTwoCompetingVaultsFillsTheSameIntent`). |
| Replay of a fill authorisation | Per-vault `agentNonceUsed`, a single `intentFilled`, a short `expiry`. |
| Forged `FillAuthorization` | ECDSA recovery against an allowlist; the struct is bound to the intent by `intentId == hash(intent)`. |
| Signature domain separation and cross-chain replay | The EIP-712 domain binds `chainId` and the vault address; the vault requires `sourceChainId != block.chainid` and `destinationChainId == block.chainid`. |
| Recipient or amount substitution | `intent.recipient == authorization.recipient`, `intent.amount == inputAmount`, `output + fee == input`. |
| Fee above the user's `maxFeeBps` | Enforced in the vault; the market adds a 150 bps ceiling; the posted tier is also enforced. |
| ERC-4626 inflation and first depositor | 10⁶ virtual shares offset; rounding favours the vault; 13 existing invariants. |
| Reentrancy | `nonReentrant` on every state-changing entry; effects before interactions; covered by `VaultReentrancy.t.sol`. |
| Withdrawal racing an in-flight fill | `totalAssets` counts receivables; `maxWithdraw` keeps the floor and exposure cap satisfied. |
| CCTP message replay | The transmitter's nonce plus the receiver's `AlreadySettled` per intent. |
| Partial mint | `minted == amount - feeExecuted` is required exactly. |
| Failed swap | `try/catch` falls back to delivering USDC; the adapter re-measures output and retained balance. A **malicious** adapter set by a vault owner is covered by C-08. |
| Intent cancellation | None by design. Canonical settlement always delivers, so an unfilled intent is not stranded (C-01, C-09 aside). |
| Stale intents | The vault enforces `deadline`; after it, only canonical settlement pays. |
| Stale intelligence or oracle data | Hedera x402 intelligence is advisory and can only withhold a fill (D13); it is not on the settlement path. |
| Solver downtime | Canonical settlement pays the recipient by fallback. |
| RPC or indexer failure | Solvers fail closed on stale observations (`maxObservationAgeSeconds` 60); C-14 covers the dependency itself. |
| Paused contracts | Vault pause blocks fills and deposits but never withdrawals or reimbursements; the receiver and market cannot be paused, so settlement stays live. |
| Upgrade and admin assumptions | No proxies or upgradeable code anywhere; fixes require redeployment and migration. |

---

## D. Testnet → mainnet configuration diff

### D.1 Network and Circle facts

| Item | Testnet today | Mainnet | Evidence |
|---|---|---|---|
| Arc chain ID | 5042002 | **5042** | ✅ chain `eth_chainId` on `https://rpc.mainnet.arc.io`; 📄 Arc "Connect to Arc" |
| Arc RPC | `arc-testnet.drpc.org` (default in code) | `https://rpc.mainnet.arc.io`; also Alchemy, Blockdaemon, dRPC and QuickNode endpoints | 📄 Arc "Connect to Arc" |
| Arc explorer | `testnet.arcscan.app` | `https://explorer.arc.io` | 📄 Arc "Connect to Arc" |
| Ethereum chain ID | 11155111 | **1** | ✅ chain |
| Ethereum RPC | `ethereum-sepolia-rpc.publicnode.com` | A paid provider; public nodes rate-limit (J-6) | ⚠️ |
| Arc USDC (ERC-20 interface) | `0x3600…0000` | **`0x3600000000000000000000000000000000000000`**, symbol `USDC`, 6 decimals | ✅ chain; ✅ Arc TokenMinter `getLocalToken(0, Ethereum USDC)` returns it |
| Ethereum USDC | `0x1c7D4B19…7238` | **`0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`**, `USDC`, 6 decimals | ✅ chain |
| TokenMessengerV2 | `0x8FE6B999…2DAA` | **`0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`** on both chains | 📄 Circle contract addresses; ✅ chain code on both; `remoteTokenMessengers` cross-registered |
| MessageTransmitterV2 | `0xE737e5cE…E275` | **`0x81D40F21F12A8F0E3252Bccb954D722d4c464B64`** on both chains | 📄; ✅ chain `localDomain()` returns 0 on Ethereum and 26 on Arc |
| TokenMinterV2 | `0xb43db544…F192` | **`0xfd78EE919681417d192449715b2594ab58f5D002`** on both chains | 📄; ✅ chain `localMinter()` on both |
| MessageV2 | `0xbaC0179b…90C4` | `0xec546b6B005471ECf012e5aF77FBeC07e0FD8f78` | 📄; ✅ chain code on Arc |
| CCTP domains | Ethereum 0, Arc 26 | Ethereum **0**, Arc **26** | ✅ chain; 📄 supported blockchains |
| Burn limit per message | — | 10,000,000 USDC on both chains | ✅ chain `burnLimitsPerMessage` |
| Standard transfer fee | 0 | 0 bps on Arc and Ethereum; no fee switch listed for either; `minFee()` returns 0 on Arc | 📄 CCTP fees; ✅ chain (Arc) |
| Fast transfer | used as 2000 (standard) | Arc listed "N/A" for fast transfer; keep threshold **2000** | 📄 supported blockchains |
| Attestation API | `iris-api-sandbox.circle.com` | **`https://iris-api.circle.com`** | 📄 CCTP technical guide |
| Message expiry | — | ~24h `expirationBlock`; `POST /v2/reattest/{nonce}` | 📄 CCTP technical guide |
| Arc finality | instant | Deterministic, final on inclusion; `finalized` trailed `latest` by 2 blocks when sampled | 📄 Arc EVM compatibility; ✅ chain |
| Arc gas | 20 gwei (in USDC, 18 dp) | Minimum base fee 20 gwei; sampled 20.0157 gwei; base fee goes to the block producer | 📄; ✅ chain |
| Arachnid CREATE2 factory | present | `0x4e59b44847b379578588920cA78FbF26c0B4956C` present on both | ✅ chain |
| Safe v1.4.1 | — | Canonical deployment listed for 5042 and 1; code present on Arc | 📄 safe-deployments; ✅ chain |
| Uniswap V2 on Arc | own fork (`~/code/uniswap-v2`), mock tokens | Factory **`0x89e5db8b5aa49aa85ac63f691524311aeb649eba`**, Router02 **`0x1f7d7550b1b028f7571e69a784071f0205fd2efa`** | 📄 Uniswap `sdk-core` `addresses.ts`; ✅ chain code, `router.factory()` matches, 221 pairs |
| Uniswap V2 on Ethereum | own fork | Factory `0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f`, Router02 `0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D` | 📄 `sdk-core`; ✅ chain code, `factory()` matches |
| The Graph network id | `arc-testnet`, `sepolia` | `arc`, `mainnet` | 📄 The Graph supported networks (Arc) |
| Circle Wallets blockchain id | `ARC-TESTNET`, `ETH-SEPOLIA` | `ARC`, `ETH`; EOA and SCA supported | 📄 Circle Wallets supported blockchains |
| Hedera x402 | `hedera:testnet`, Blocky402 testnet facilitator | Disabled at launch (J-8) | — |

### D.2 Arc one-balance and native USDC audit

📄 Arc EVM compatibility: native USDC (18 decimals) and the ERC-20 interface (6 decimals) share one balance. Native transfers emit EIP-7708 `Transfer` logs from a system address. Value transfers to `0x0` revert. Blocklist enforcement happens at runtime.

| Area | Finding | Status |
|---|---|---|
| Contracts: `msg.value`, `payable`, `receive`, `selfdestruct`, `prevrandao`, `.transfer`/`.send` | None in `contracts/src` outside mocks | ✅ Safe |
| Contracts: accounting | All balances use the ERC-20 interface at 6 decimals; no native reads | ✅ Safe |
| Receiver mint check | `balanceOf` before and after `receiveMessage`, 6 decimals, matches CCTP's 6-decimal amounts | ✅ Safe |
| Native dust below 10⁻⁶ USDC | Invisible to `balanceOf`; contracts cannot receive native value except by forced `SELFDESTRUCT`, which only raises share price | Low, accept |
| Block timestamps non-decreasing, not strictly increasing | All deadline and expiry checks use `<=`/`>`, which is safe with repeated timestamps | ✅ Safe |
| Blocklist | Affects fallback payment (C-09), fills to blocked recipients (they revert, no loss), and blocked LP withdrawals (revert, no loss) | C-09 |
| Operational wallets on Arc | Solver submitters, the settlement worker and the Circle agent wallet pay gas from the same USDC they may hold; a sweep can strand a wallet without gas | Runbook: separate gas float per wallet with alerts |
| `apps/web/src/routes/earn.tsx:257` | Arc gas top-up uses `parseEther("2")`, which is correct for 18-decimal native USDC | ✅ Correct |
| `scripts/bot-balances.ts` | Reads native balance on Arc as 18 decimals and does not also add the ERC-20 read | ✅ Correct |
| Indexers | Neither the subgraph nor the Nest indexes `Transfer`, so EIP-7708 system logs cannot double count | ✅ Safe |
| Web and solver display | Any future "USDC balance" UI on Arc must use one read, never native plus ERC-20 | Guidance |

### D.3 Repository changes for a production profile

Preserve testnet as an explicit profile rather than deleting it. Select it with `ARCAIDIA_NETWORK=testnet|mainnet`, with **no default**.

| Location | Today | Mainnet change |
|---|---|---|
| `packages/domain/src/config/chains.ts` | `ChainKey = 'ethereum-sepolia' \| 'arc-testnet'`, testnet CCTP constants, public-RPC and hackathon defaults | Profile-scoped chain maps; mainnet map uses the D.1 values; RPC and subgraph URLs required from environment |
| `packages/domain/src/config/deployments.ts` | Testnet v2 addresses, retired receivers | Separate mainnet record, written by the deploy script, with no retired list at launch |
| `packages/domain/src/config/markets.ts` | Mock tokens `mETH`/`mAAVE`/`mGRT`/`mPEPE` on our own fork | Empty at launch; later only allowlisted real pairs on official Uniswap V2 |
| `packages/agent/src/risk/default-policy.ts` | `v2-testnet-2026-09`, 1 confirmation | Mainnet policy per C-05; conservative caps from section H |
| `packages/agent/src/entrypoint/viem-chains.ts`, `packages/settlement/src/entrypoint/viem-chains.ts`, `packages/loadgen/src/entrypoint/main.ts` | Hardcoded Arc Testnet chain definitions | Chain definitions from the profile |
| `packages/settlement/src/entrypoint/config.ts` | Help text points at the sandbox Iris API | Require `IRIS_BASE_URL`; the mainnet profile asserts `iris-api.circle.com` |
| `packages/agent/scripts/setup-circle-agent-wallet.ts` | Creates the wallet on `ARC-TESTNET` | Blockchain ids from the profile (`ARC`, `ETH`) |
| `packages/x402-gateway`, `packages/agent/src/adapters/x402-paying-fetch.ts`, `apps/web/src/lib/arcaidia/x402-pay.ts` | `hedera:testnet` | Excluded from the mainnet profile; the solver runs with intelligence off |
| `packages/loadgen`, `loadgen*.config.json`, `.env.loadgen`, market bot (`.env.market`, `~/code/uniswap-v2/bots`) | Synthetic intents and price movement | Testnet profile only; never in the mainnet compose file |
| `.env.solver-b/c/d` | Three "independent" demo solvers whose vaults are all owned by `0xE6f3…Ee4B` | Testnet only; mainnet launches with the House Vault alone |
| `apps/web/src/lib/arcaidia/{chains,config,viem-clients}.ts` | `sepolia` and a hand-defined `arcTestnet`, hackathon Nest, public RPC fallbacks | Profile-driven; required `VITE_*` values; no public RPC fallbacks for writes |
| `apps/web/src/routes/docs.tsx`, `trade.tsx`, `earn.tsx` | Testnet copy and faucet-style gas top-up | Mainnet copy; no auto top-up; the C-08 disclosure |
| Relay "pseudo telemetry", `/intelligence` | Demo surfaces | Disabled in the mainnet profile until real data exists |
| `subgraph/subgraph.*.yaml` | Generated for the testnets | Generate `subgraph.arc.yaml` and `subgraph.mainnet.yaml` from the mainnet record |
| `contracts/script/*.s.sol` | Testnet defaults (C-06) | Manifest-driven; revert on unknown chain |
| `scripts/redistribute.sh`, `recover-*.sh`, `bot-balances.ts`, `docker-compose.ops.yml` loadgen profile | Testnet tooling | Testnet only; a separate mainnet compose file |
| CI | None for configuration | Build the mainnet web bundle and solver image, then fail if `5042002`, `11155111`, `sandbox`, `sslip.io`, `hedera:testnet`, `Mock` or `loadgen` appear |

---

## E. Contract deployment manifest

### E.1 Manifest

Addresses marked ✅ in D.1 are the only external addresses allowed. "Predicted" means computed by the restricted deployer before broadcast and asserted after it.

| # | Contract | Constructor args | Init call (same transaction) | Owner / admin after handover | Dependencies | Deterministic? | Verification |
|---|---|---|---|---|---|---|---|
| 0 | Safe (protocol owner), per chain | Safe factory `createProxyWithNonce`, M-of-N | — | Signers per J-2 | Safe v1.4.1 (✅) | CREATE2 via Safe factory | Safe UI plus `getOwners()` / `getThreshold()` |
| 1 | `ArcaidiaDeployer` (restricted per C-03) | `owner = deploy key` | — | Deploy key; retired after launch | Arachnid factory (✅) | **Yes**: same address both chains | Runtime bytecode hash vs `forge inspect` |
| 2 | `SettlementReceiver` | none | `initialize(deployKey, USDC, predictedMarket, MessageTransmitterV2)` | Safe | USDC, MessageTransmitterV2, market | **Yes** | Bytecode hash; `market()`, `messageTransmitter()`, `asset()`, trusted source per C-01 |
| 3 | `ArcaidiaIntentMarket` | `(receiver, predictedFactory)` | — (no owner) | none | receiver, factory | **Yes** | `settlementCheck() == receiver`, `vaultRegistry() == factory` |
| 4 | `ArcaidiaVaultFactory` | none | `initialize(deployKey, USDC, market, receiver)` | Safe | market, receiver | **Yes** | `market()`, `settlementReceiver()` |
| 5 | `CircleCCTPInitiator` | `(deployKey, TokenMessengerV2, USDC, predictedRouter)` per C-01 | — | Safe | TokenMessengerV2, USDC, router | **Optional.** Arguments are identical on both chains, so CREATE2 parity is possible but not needed | `tokenMessenger()`, `settlementAsset()`, `router()` |
| 6 | `ArcaidiaIntentRouter` | none | `initialize(deployKey, USDC, initiator, maxIntentAmount, maxInFlightValue)` | Safe | USDC, initiator | **Yes** | `settlementInitiator()`, limits |
| 7 | House Vault `ArcaidiaLiquidityVault` | via `factory.createVault(salt, floor, fill, exposure, policy, label)` | atomic inside the factory | Safe | factory, market, receiver | **Yes**: factory CREATE2 by creator and salt | `isFactoryVault`, `market()`, `settlementReceiver()`, `feePolicy()` |
| 8 | `UniswapV2SwapAdapter` | `(UniswapV2Router02 per chain, owner)` | — | Safe | Router02 (✅ per chain) | **No.** Router differs per chain, and parity has no value here | `router()`, `factory()` |

**Order and wiring, per chain, then across chains:**

1. Steps 1–7 on **Arc**, then steps 1–7 on **Ethereum**. Do not wire anything cross-chain yet.
2. Run the section G assertion script on both chains. Stop on any mismatch.
3. On each chain, as the deploy key:
   - `initiator.setDomain(otherChainId, otherDomain)`.
   - `receiver.setTrustedSource(otherDomain, otherInitiator)` (new, C-01).
   - House Vault: `setTreasury`, `setProtocolFeeShareBps`, `setAuthorisedSigner(CircleWallet)`, with limits from section H.
   - Swap adapter left unset at launch.
4. On each chain, `router.setDestination(otherChainId, otherReceiver)`. Only after step 2 verified the other chain.
5. Hand over ownership of router, receiver, factory, initiator and House Vault to the Safe, using the two-step handover after C-20. The Safe accepts. Re-run the assertions with `owner == Safe`.

### E.2 CREATE2 decision

| Contract | Use CREATE2? | Why |
|---|---|---|
| Router, receiver, market, factory | **Yes, through a restricted deployer, with new mainnet salts** | The same addresses on both chains make the cross-chain `setDestination` value checkable at a glance and give users one address to verify. Parity stays a convenience: each router stores its destination explicitly, and step 2 verifies it. Restricting the deployer removes the squatting risk in C-03. |
| House Vault and third-party vaults | **Yes, through the factory** (existing) | Unchanged. Salting by creator already prevents front-running another creator's address. |
| `CircleCCTPInitiator` | Optional | No correctness dependency. |
| `UniswapV2SwapAdapter` | **No** | Its constructor argument differs per chain. |
| `ArcaidiaDeployer` | **Yes, through Arachnid** | Needed for parity of everything it deploys. |

Testnet addresses must not be reused. The contracts change for C-01 through C-04, so their init code, and therefore their addresses, will differ anyway. New salts make the separation explicit.

### E.3 Keys and signers

**Today, on testnet**, derived from public addresses only:

| Key | Address | On-chain power |
|---|---|---|
| `deployKey` (cast keystore) | `0x538e…65b0` | Owner of every protocol contract, House Vault owner, treasury, only reporter, adapter owner |
| House solver signer | Circle wallet `0x6b73…3424` | Authorised signer, House Vault |
| House fill submitter | `0x21F6…1cf2` | None; relays signed fills |
| Settlement worker | `0x1BBC…9862` | None on the live receiver; submits `settleWithProof` |
| Solver B / C / D signers | `0xe9eB…1C13`, `0xC3Ab…54CB`, `0x72c8…0dc0` | Authorised signers on vaults owned by `0xE6f3…Ee4B` |
| Solver B / C / D submitters | `0x90f9…3F90`, `0xDfCD…79cC`, `0xC3D0…6B29` | None |
| Loadgen users (2) | from `LOADGEN_USER_KEYS` | None; synthetic users |
| Market bot | `0x3872…7EcB` | None; moves testnet fork prices |
| Hedera payer | `HEDERA_ACCOUNT_ID` | Pays x402 on Hedera testnet |

**Proposed for mainnet launch:**

| Role | Holder | Can | Cannot |
|---|---|---|---|
| **Protocol owner** | Safe on each chain (J-2) | Router pause, limits, destination; receiver trusted source; initiator domain and finality; release in-flight; own House Vault and adapter | Move LP principal or settlement funds directly |
| **Deployment key** | Fresh hardware-backed EOA, per chain | Deploy and wire during the run only | Anything after handover; holds only gas |
| **Emergency pause** | Today this is the owner, so the Safe | `router.setPaused`, `vault.setPaused` | — |
| | *Recommended:* a pause-only guardian key, which needs a small contract change | Pause only | Unpause, configure or transfer |
| **Treasury** | Separate Safe or address | Receive protocol fees | Anything else |
| **House Vault owner** | Protocol Safe | Signer, limits, adapter, pause, fee sweep | Withdraw LP principal (C-08 aside) |
| **Authorised solver signer** | Circle developer-controlled wallet, with `ARC` and `ETH` records | Sign fills up to House Vault caps | Change configuration |
| **Fill submitter** | Hot EOA on each chain, gas float only | Relay signed fills | Anything authorised |
| **Settlement worker** | Hot EOA on each chain, gas float only | `settleWithProof`, `retryHeld` (both permissionless) | Anything privileged (no reporter role after C-04) |
| **Third-party vault owners** | Their own keys | Their own vault | Anything protocol-wide |

**Not present on mainnet:** loadgen users, market bot, solver B/C/D demo keys, Hedera payer, reporter role.

The Safe is justified by C-07: without it one key compromise can redirect every new intent's canonical USDC. A DAO is not recommended for launch, since nothing in the threat model requires it.

---

## F. Required tests

### F.1 Before mainnet

| Test | Type | Status |
|---|---|---|
| Existing Foundry suite, both directions | unit, fuzz, invariant | ✅ 406 passing |
| `MainnetReadinessPoC.t.sol` PoCs inverted into regression tests (C-01, C-02, C-03, C-04, C-09, C-11) | unit | To do with each fix |
| `test_Fix_*` and `testFuzz_Fix_noClaimAfterLiveSettlement` | unit and fuzz | ✅ passing now; keep |
| Deployment wiring: all seven B-0 equalities after `deployAll`, and every contract `initialized()` immediately after its own deploy | unit | To add |
| Ethereum mainnet fork: router → initiator → real TokenMessengerV2 `depositForBurnWithHook`; parse the real `MessageSent` with `CctpMessageLib`; assert `messageSender == initiator`, `sourceDomain == 0`, hook round-trips | fork | To add |
| Arc mainnet fork: receiver with the real MessageTransmitterV2; enable a test attester through the attester manager with `vm.prank`, threshold 1; settle a signed message; assert routing | fork | To add |
| Solver: Ethereum finality gate (C-05), `DepositForBurn` verification (C-12) | TypeScript unit | To add |
| Settlement worker: re-attestation (C-13) | TypeScript unit | To add |
| Configuration guard: mainnet bundle and image contain no testnet ids or hosts | CI | To add |

### F.2 Protocol invariants

Existing coverage: `VaultInvariants.t.sol` holds 13 single-vault accounting invariants (share backing, exposure tally, floor, fees). The invariants below need a **multi-vault, market and receiver handler**: several factory vaults, random intents, random fill order, random delivery of genuine messages, spoofed messages, and deposits and withdrawals in between.

| ID | Invariant | Handler actions | Proves |
|---|---|---|---|
| INV-01 | For every intent, at most one vault has `intentFilled` true, and it equals `market.filledBy` | `fill(vault_i, intent_j)` | Single fast fill |
| INV-02 | `receiver` pays `LpReimbursed` only to `market.filledBy(id)`, and only when `vault.advancedPrincipal(id) > 0` was true beforehand | `settle(genuine_j)` | No wrong-vault reimbursement |
| INV-03 | `Σ vault.outstandingExposure == Σ advancedPrincipal` over filled, unreimbursed intents; after all genuine messages are delivered it is 0 | `settle`, `retryHeld` | Exposure conservation |
| INV-04 | `vault.totalAssets() ≥ vault.totalSupply() × lastSharePrice` except across a recorded loss event (after C-10) | all | LP solvency through fill → settle → withdraw |
| INV-05 | Every `FastFilled.feeAmount ≤ ceil(amount × maxFeeBps / 10⁴)`, `≤ 150 bps`, and `≤` the tier at pre-fill utilisation | `fill` with random fees | Fee ceilings |
| INV-06 | For any signature and a mutated `(intent, authorization)`, the vault balance changes only by `outputAmount` to `intent.recipient` for a valid tuple; otherwise it reverts | `fillMutated` | Signatures cannot authorise arbitrary capital movement |
| INV-07 | `receiver.isSettled(id)` never changes `market.filledBy(id)`, and a fill never changes `outcomeOf(id)` | all | Fast-fill and canonical states separately observable |
| INV-08 | For trade intents, the recipient ends with either `≥ targetMinOut` of `tokenOut` or exactly `outputAmount` USDC, never less | `fill` with a flaky adapter | Failed destination execution never destroys value |
| INV-09 | No message whose `messageSender` or `sourceDomain` differs from the trusted pair changes any state (after C-01) | `settleSpoofed` | C-01 |
| INV-10 | `usdc.balanceOf(receiver) == Σ settledAmount` over intents in a HELD state | all | The receiver never holds unaccounted funds |
| INV-11 | Once `receiver.isSettled(id)`, `market.claimIntent(id, …)` reverts for every factory vault | `settle`, then `claim` | No late claim (fuzz already implemented) |
| INV-12 | For every genuine message, `settleWithProof` eventually succeeds, including blocked recipients after C-09 | `settle`, `block/unblock` | Canonical funds never permanently locked |

Run them under the `ci` profile (256 runs, depth 64) in both `ARCAIDIA_SOURCE` directions.

---

## G. Deployment runbook

Nothing below may run until the user approves this report and every B-item is closed.

### G.1 Preconditions (all must be true)

1. All B-items closed. `forge test` green in both directions, including the inverted PoCs, fork tests and new invariants.
2. An external review of the diff that fixes C-01 through C-04 and C-09 through C-10 (J-3).
3. `contracts/deploy/mainnet.json` contains only D.1 values marked ✅, re-verified that day with the commands in G.3.
4. Safes exist on both chains with the agreed signers and threshold.
5. Deploy key funded with gas only: ETH on Ethereum, native USDC on Arc.
6. Circle wallet records `ARC` and `ETH` created for the House signer, production Circle API key and entity secret stored in the ops secret store, not in a `.env` on a laptop.
7. Mainnet subgraphs deployed and synced to head. Iris mainnet reachable from the ops host.
8. Mainnet ops compose file contains only the House solver, settlement worker and relay. No loadgen, market bot or x402.

### G.2 Dry run

```bash
forge script script/DeployMainnet.s.sol --fork-url $ARC_MAINNET_RPC_URL --sender $DEPLOY_KEY_ADDRESS
```

```bash
forge script script/DeployMainnet.s.sol --fork-url $ETHEREUM_MAINNET_RPC_URL --sender $DEPLOY_KEY_ADDRESS
```

Go only if both runs predict the same router, receiver, market, factory and House Vault addresses, all assertions pass on the fork, and simulated gas is within the funded amount.

### G.3 Pre-flight re-verification of external facts

```bash
cast chain-id --rpc-url $ARC_MAINNET_RPC_URL
```

```bash
cast call 0x81D40F21F12A8F0E3252Bccb954D722d4c464B64 "localDomain()(uint32)" --rpc-url $ARC_MAINNET_RPC_URL
```

```bash
cast call 0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d "remoteTokenMessengers(uint32)(bytes32)" 0 --rpc-url $ARC_MAINNET_RPC_URL
```

```bash
cast call 0x3600000000000000000000000000000000000000 "decimals()(uint8)" --rpc-url $ARC_MAINNET_RPC_URL
```

Expected values: `5042`, `26`, `0x…28b5a0e9c621a5badaa536219b3a228c8168cf5d`, `6`. Repeat for Ethereum with `1`, `0`, `remoteTokenMessengers(26)` and USDC `0xA0b8…eB48`. Stop on any difference.

### G.4 Broadcast

1. Arc: broadcast steps 1–7 of E.1 with the deploy key.
2. Ethereum: broadcast steps 1–7 of E.1.
3. Run the assertion script on both chains. It checks every E.1 "Verification" column and the seven B-0 equalities, and compares runtime bytecode hashes with `forge inspect <Contract> deployedBytecode`. Stop on any failure. Nothing is funded yet, so abandoning here loses only gas.
4. Wiring step 3 of E.1, on both chains.
5. Cross-chain `setDestination` on both routers, then re-run the assertions.
6. Hand ownership to the Safes and accept. Re-run the assertions with the Safe as owner.
7. Source-verify each contract on each explorer (J-7), and record the addresses and deployment blocks in the mainnet deployment record.
8. Generate and deploy the mainnet subgraphs from that record, starting at the deployment blocks.

---

## H. Post-deployment smoke test and safe launch

### H.1 Observability that must exist first

To prove `intent → solver discovery → fill → CCTP settlement → vault replenishment` from production data alone, each hop needs a source:

| Hop | Source of truth | Observed through |
|---|---|---|
| Intent | `IntentCreated` on the source router, plus `DepositForBurn` in the same receipt | Subgraph `Intent` entity; source RPC receipt |
| Solver discovery and decision | Solver decision log (`intentId`, verdict, reasons, confirmations, fee) | Relay telemetry, persisted, not only in memory |
| Fill | `IntentClaimed` on the market and `FastFilled` + `FillRecorded` on the vault | Subgraph; destination RPC |
| CCTP attestation | Iris `GET /v2/messages/{sourceDomain}?transactionHash=` status `complete` | Settlement worker log with the Iris response hash |
| Canonical settlement | `SettledWithProof` and `LpReimbursed` or `RecipientPaidByFallback` on the receiver | Subgraph; destination RPC |
| Replenishment | `ReimbursementRecorded` and `FeesAccrued` on the vault; `outstandingExposure` back down | Subgraph; `eth_call` |

**Alerts to wire before funding:** HELD events; `settleWithProof` failures; Iris message pending beyond 60 minutes; `outstandingExposure` older than the settlement SLA; `totalInFlight` above 70% of cap; gas float below threshold on any hot wallet; indexer head lag above 5 minutes; any receiver `settleWithProof` call whose `SettledWithProof` was not initiated by the worker (early warning for C-01-style activity).

### H.2 Launch sequence with stop/go criteria

Launch limits, all set through the Safe: router `maxIntentAmount` 25 USDC, `maxInFlightValue` 250 USDC; House Vault 100 USDC deposit, `maxFillBps` 5000, `maxExposureBps` 5000, `reserveFloorBps` 2000. These are ⚠️ proposals (J-5).

| Stage | Action | Go if | Stop if |
|---|---|---|---|
| 1. Deploy | G.4 steps 1–2 | Both chains deployed at predicted addresses | Any address mismatch or revert |
| 2. Source verify | G.4 step 7 | Explorer shows verified source matching bytecode hash | Hash mismatch |
| 3. Configure | G.4 steps 3–6 | Assertion script passes with Safe ownership; routers unpaused | Any assertion fails |
| 4. Smoke test, no value | Read-only calls: `quote`, `currentFeeBps`, `supportsDestination`, `quoteIntentId` compared with the TypeScript `computeIntentId` | Every value equals the expected value; `quoteIntentId` matches TypeScript byte for byte | Any mismatch |
| 5. Fund | Safe deposits 100 USDC into the Arc House Vault; later 100 USDC into the Ethereum House Vault | `totalAssets() == 100e6`; shares `== 100e12`; `Deposit` indexed | Share or asset mismatch |
| 6. Tiny intent | A team wallet creates a 5 USDC Ethereum → Arc intent, then a 5 USDC Arc → Ethereum intent | `IntentCreated` and a `DepositForBurn` whose `mintRecipient`, `destinationCaller`, domain, amount and hook are all exact | Any field differs; halt both routers |
| 7. Fast fill | Solver fills after the finality gate | One `IntentClaimed` + `FastFilled` by the House Vault; recipient received `amount − fee`; `outstandingExposure == amount − fee`; the decision log shows ACCEPT with confirmations ≥ policy | No fill within finality plus 5 minutes; or fee above `maxFeeBps`; or a second payment of any kind |
| 8. Canonical settlement | Worker settles after attestation | Iris `complete`; `SettledWithProof` with outcome LP_REIMBURSED; no HELD | HELD, revert, or pending beyond 60 minutes: pause routers and investigate |
| 9. Exact accounting | `eth_call` before and after | `outstandingExposure == 0`; `liquidBalance` increased by exactly `amount`; `accruedProtocolFees == floor(fee × share / 10⁴)`; `totalAssets == 100e6 + fee − protocolFee` | Any off-by-one |
| 10. Withdrawal | Safe redeems 10% of shares, then the rest after a no-fill fallback test | Assets received equal `previewRedeem`; floor and exposure limits respected | Assets received differ from preview |
| 10b. Fallback path | Pause the House solver; send a 5 USDC intent; let the deadline pass | `RecipientPaidByFallback` pays exactly 5 USDC once; no fill occurs afterwards | Any fill after settlement (C-02 regression) |
| 11. Increase exposure | Only after 7 consecutive days and at least 50 successful round trips with zero HELD, zero double payments and every alert quiet | Raise limits by at most 5× per step, with the same 7-day criteria per step | Any incident resets the step |

Third-party vault creation stays hidden in the UI until stage 11 has run for at least two steps and C-08's disclosure is live.

---

## I. Rollback and pause procedure

Contracts are not upgradeable. "Rollback" therefore means **stop intake, let in-flight intents settle, withdraw, and redeploy**.

### I.1 What can and cannot be paused

| Contract | Pausable? | Effect |
|---|---|---|
| `ArcaidiaIntentRouter` | `setPaused(true)` (owner) | Stops new intents. Existing burns still settle. |
| `ArcaidiaIntentRouter` | `setTradeIntentsAllowed(false)` | Stops trade intents only. |
| House Vault | `setPaused(true)` (owner) | Stops fills and deposits. Withdrawals and reimbursements continue. |
| Third-party vaults | Only by their owners | The protocol cannot pause them. Pausing the routers stops their new work. |
| House Vault swap adapter | `setSwapAdapter(address(0))` | Every trade intent is delivered in USDC. |
| `SettlementReceiver` | **No** | Deliberate: settlement must stay live. |
| `ArcaidiaIntentMarket` | **No** | No funds held. |
| Solvers and worker | Stop containers | Off-chain only. |

### I.2 Incident procedure

1. **Contain, within minutes.** The Safe pauses both routers, pauses the House Vault and removes the swap adapter. Stop the House solver. Keep the settlement worker running unless the incident is in settlement itself.
2. **Assess.** List in-flight intents from the source routers against `outcomeOf` on both receivers. List HELD intents. List vault `outstandingExposure`.
3. **Drain in-flight work.** Let the worker settle every genuine message, re-attesting where expired. Call `retryHeld` where the cause is fixed.
4. **Protect LPs.** Once `outstandingExposure == 0`, LPs withdraw in full. If a receivable is permanently unrecoverable, publish the loss per vault before any further withdrawals so later LPs are not left carrying it (this is the C-10 dynamic).
5. **Redeploy if needed.** Fix, test, and deploy a new set per section G with new salts. Receiver, market and factory are always replaced together (C-02). Point the web app at the new set. Leave the old routers paused permanently and the old receivers untouched, so late genuine messages still settle.
6. **Communicate.** Post the affected intent ids, amounts and remediation.

### I.3 Stuck-funds matrix

| Situation | Recoverable? | Path |
|---|---|---|
| Message expired | Yes | `POST /v2/reattest/{nonce}`, then `settleWithProof` |
| HELD, vault mis-wired | Yes | Vault owner fixes its receiver pointer; anyone calls `retryHeld` |
| HELD, amount below principal | **Not with current code** | Needs the C-10 fix |
| Recipient blocklisted | **Not with current code** | Needs the C-09 fix |
| Spoofed hook settled first | **Not with current code** | Needs the C-01 fix |

---

## J. Outstanding questions requiring a human decision

| # | Question | Why it matters | Recommendation |
|---|---|---|---|
| J-1 | Counterpart chain | Every D.1 value and the finality gate (C-05) | **Decided:** Ethereum Mainnet ↔ Arc Mainnet |
| J-2 | Safe signers and threshold on each chain | Protocol owner security (C-07) | 2-of-3 hardware wallets held by different people |
| J-3 | External audit scope and timing for the C-01 to C-04 and C-09/C-10 fixes | These changes touch settlement, the most sensitive path | Required before stage 5 funding |
| J-4 | Pause-only guardian role; operator timelock (C-08) | Incident response latency; LP protection in third-party vaults | **Decided:** no guardian for now, the Safe pauses. Timelock still recommended before third-party vaults are exposed in the UI |
| J-5 | Launch limits in H.2 | Maximum loss during early operation | Accept, or set lower |
| J-6 | RPC providers and Iris quota | Public RPCs rate-limited and caused testnet outages | Paid provider per chain, plus a second as fallback |
| J-7 | Contract verification route for `explorer.arc.io` | Arc's explorer type and verification API were not confirmed in this audit | Confirm with Arc docs or support before deploy day |
| J-8 | Hedera x402 on mainnet | Needs Hedera mainnet, a production facilitator and real funds; not on the settlement path | **Decided:** off at launch; opt-in upgrade in plan M3 |
| J-9 | Uniswap trade intents at launch | Adds adapter, liquidity and pair-allowlist risk (C-17, C-19) | **Decided:** off at launch; plan M1 then M2 |
| J-10 | Protocol fee share and treasury address | Economic parameter | Keep 50% share only if the treasury is a Safe |
| J-11 | Circle production account for developer-controlled wallets and the entity secret's custody | House signer custody (C-08) | Secret in a managed secret store; audit Circle API key scope |
| J-12 | Keep or remove the reporter valve (C-04)? | Recovery flexibility against a proven attack path | Remove |
| J-13 | Clean up testnet: vault `0x180d1c22…E5Ae` phantom receivable and the stale testnet factory | Testnet accuracy only | Document; do not fix on testnet while it is under judging |

---

**SAFE TO DEPLOY: NO.** Blockers B-1 through B-9 must close first.
