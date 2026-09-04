# WP-01 — Symmetric chain core (M1)

**Objective:** write the four contracts **once** and deploy the same bytecode to both Ethereum and
Arc. There is no `EthereumIntentRouter` and no `ArcVault`.

**Depends on:** WP-00. **Blocks:** WP-02, WP-03, WP-05.
**Stack:** Solidity, Foundry, OpenZeppelin.

## Sub-tasks

- [ ] **1.1 Foundry project** under `contracts/`, OZ as a dependency, `forge fmt` + CI wired.
- [ ] **1.2 `MockUSDC.sol`** — 6-decimal mintable OZ ERC20, development only. Not a code path:
      the protocol only ever sees a configured `IERC20 settlementAsset`.
- [ ] **1.3 `ArcaidiaIntentRouter.sol`.** `createIntent(...)` pulls USDC via `transferFrom`,
      initiates the CCTP transfer through a `ISettlementInitiator` seam (mock now, Circle in
      WP-10), and emits `IntentCreated` **only after both succeed**. Stores the intent with
      immutable economic fields. Enforces: allowlisted token, allowlisted destination chain,
      per-intent cap, total in-flight cap, deadline in the future, unused nonce.
      **No cancel/withdraw path after CCTP commitment.**
- [ ] **1.4 `ArcaidiaLiquidityVault.sol`.** LP `deposit`/`withdraw` with share accounting or
      straight balance accounting (keep it explicit and simple), `reserveFloor`, `pause`,
      allowlisted solver signers, `fastFill(FillAuthorization, signature)`. Skeleton in this WP;
      the safety matrix is WP-02 and signature verification is WP-05.
- [ ] **1.5 `SettlementReceiver.sol`.** Receives canonical USDC, correlates to `intentId`/`cctpRef`,
      routes to LP reimbursement when `FAST_FILLED` or to the recipient fallback when not.
      Emits a settlement event carrying both facts.
- [ ] **1.6 Solidity `intentId`** must byte-for-byte match `packages/domain/src/intent-id.ts`.
      Add a differential test fixture asserting it.
- [ ] **1.7 Events designed for indexing.** `IntentCreated`, `FastFilled`, `SettlementReceived`,
      `LiquidityDeposited`, `LiquidityWithdrawn` — each carrying everything The Graph and the
      agent need, including the CCTP reference. Designing these badly costs a re-deploy in WP-08.
- [ ] **1.8 CREATE2 deterministic deployment.** A deploy script computing the expected address
      from init code + salt, asserting it **before** broadcast and asserting the deployed address
      after. Identical init code on both chains → chain-specific values (USDC address, CCTP domain,
      peer addresses) applied via a post-deploy `initialize`, never as constructor args.
- [ ] **1.9 Config emission.** Deployment writes addresses back into `packages/domain` config and
      the ABI barrel, so the frontend/agent never hardcode an address.

## Tests (Foundry)

- Router happy path: pull → CCTP initiate → event, with correct immutable fields.
- Router rejects: unapproved token, unapproved destination, expired deadline, reused nonce,
  over-cap intent, over-cap in-flight total, failed CCTP initiation (must revert the whole tx —
  no intent may exist without its CCTP commitment).
- `intentId` differential test vs the TypeScript fixture.
- CREATE2: predicted address == deployed address; the same salt + init code on a second local
  chain yields the same address.
- Vault deposit/withdraw basics and `pause`.

## Acceptance gate

Contract unit tests green. Direction is configuration. CREATE2 expected addresses are deterministic
and asserted on two chains. Same ABI deployed as both the "Ethereum instance" and the "Arc instance".

## Traps

- Constructor args that differ per chain — they change the init-code hash and break same-address
  deployment. This is the single most likely way to fail this gate.
- Emitting `IntentCreated` before the CCTP initiation returns. That would let a fast fill happen
  against an uncommitted source.
- Under-specified events. Add the field now; re-deploying after the subgraph exists is expensive.
