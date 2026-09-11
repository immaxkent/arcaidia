# WP-25 — Source side: router v2 + CCTP hook metadata (M25)

**Objective:** `createIntent` accepts the v1.1 intent, emits every solver-relevant field, and
commits `(intentId, recipient)` into the CCTP message itself so the destination can associate
canonical funds cryptographically.

**Depends on:** WP-24. **Blocks:** WP-27, WP-28, WP-29. **Stack:** Foundry. **Decisions:** D5, D8.

## Sub-tasks

- [x] **25.1 `createIntent(recipient, amount, destinationChainId, maxFeeBps, deadline, nonce, tokenOut, targetMinOut)`.**
      Validation: `tokenOut == 0 ⇒ targetMinOut == 0`; `tokenOut != 0 ⇒ targetMinOut > 0`;
      `tokenOut != inputToken`. Builds the v1.1 struct with `intentVersion = INTENT_VERSION`.
      `quoteIntentId` mirrors. Owner flag `tradeIntentsAllowed` (default **true**, D5) exists only
      as an emergency brake.
- [x] **25.2 `IntentCreated` v2 — flat params** (three indexed topics unchanged, all v1.1 fields +
      `settlementRef`). Emitted from a dedicated internal `_emitCreated(Intent memory, bytes32, bytes32)`
      to keep `createIntent`'s frame small under `via_ir = false` — **it compiled first time with
      flat params; `_commit`/`_emitCreated`/`_validateTradeTerms` are the split.** The fallback was `IntentCreated(bytes32 indexed, address indexed, address indexed, Intent intent, bytes32 settlementRef)`
      and record it in WP-27 (graph-ts tuples; Nest confirm).
- [x] **25.3 `ISettlementInitiator.initiateSettlement(asset, amount, destinationChainId, destinationReceiver, intentId, bytes hookData)`.**
      Router passes `IntentHookLib.encode(intentId, recipient)`. `MockSettlementInitiator` stores
      the last `hookData` per intent (tests + e2e read it back).
- [x] **25.4 `CircleCCTPInitiator` v2.** `depositForBurnWithHook(..., destinationCaller = bytes32(destinationReceiver), maxFee, minFinalityThreshold, hookData)`.
      `ITokenMessengerV2` gains the function; `MockTokenMessengerV2` records `hookData` and
      `destinationCaller`. Keep `depositForBurn` path only for empty hookData (never used by the router).
- [x] **25.5 New salts.** `ArcaidiaDeployment.ROUTER_V2_SALT = keccak256("arcaidia.v2.intent-router")`;
      the v2 router is deployed by `deployAllV2` (WP-26.6). Nothing deploys yet.
- [x] **25.6 `pnpm abi:generate`.**

## Tests (`contracts/test`, both directions via `ARCAIDIA_SOURCE`)

- [x] USDC-only intent: event fields, `intentId == computeIntentId(v1.1)`, hookData decodes to
      `(1, intentId, recipient)`, `destinationCaller == receiver`.
- [x] Trade intent: accepted; `targetMinOut = 0` with `tokenOut != 0` reverts; `targetMinOut != 0`
      with the sentinel reverts; owner brake refuses trade intents only. (`tokenOut == inputToken`
      is *not* checked — `tokenOut` is a destination-chain address, comparing it to the source
      asset is meaningless.)
- [x] Everything in `ArcaidiaIntentRouter.t.sol` / `CircleCCTPInitiator.t.sol` today, ported
      (+ hook path names the receiver as `destinationCaller`; empty hook keeps v1 behaviour;
      hook burn reverts atomically).
- [ ] Fork/live test (deferred to WP-31's dry run — same evidence, one place) (optional, `ETHEREUM_SEPOLIA_RPC_URL` set): `depositForBurnWithHook` against
      the real `TokenMessengerV2` succeeds with a 96-byte hook (no broadcast — `vm.createSelectFork`).

## Acceptance gate — met 2026-09-11

Also landed here because they consume the router ABI directly: the agent's source-evidence
decoder/verifier compare `intentVersion`/`tokenOut`/`targetMinOut` against the chain; the e2e
`createIntent` helper passes and reads back the v1.1 terms (`LEGACY_V1_INTENT_FIELDS` gone from
it); the subgraph manifest template carries the v2 signature (mappings follow in WP-27); the
Transfer hook passes `(USDC_TOKEN_OUT, 0)` until WP-30.

`pnpm test:sc` green both directions; `IntentCreated` carries every field a solver needs without
any off-chain lookup; every CCTP burn carries the intent hook and names the receiver as caller.
