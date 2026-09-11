# WP-15 — IntentMarket contract + IArcaidiaSolverVault interface (M15)

**Objective:** the on-chain arbitrator that lets many independently-owned vaults compete for the
same intent, first-valid-fill, with no auction clock and no window for a losing bid to be
front-run into a winning one.

**Depends on:** WP-02 (vault safety), WP-05 (fill authorization — `FillAuthorizationLib` reused
verbatim). **Blocks:** WP-16. **Stack:** Foundry, `contracts/src`.

**Design source:** `work-packages/WP-INTENT-MARKET.md` §2–4. Read that first; this WP is its
contract half made concrete.

## Sub-tasks

- [x] **15.1 `IntentOpportunity` struct.** `intentId`, `sourceChainId`, `destinationChainId`,
      `recipient`, `inputAmount`, `maxFeeBps`, `deadline`, `consumed` — the on-chain-readable half
      of `Intent`. Lives in `contracts/src/libraries/ArcaidiaTypes.sol` alongside
      `FillAuthorization`.
- [x] **15.2 `IArcaidiaSolverVault` interface.** At minimum `quote(IntentOpportunity) view` and
      `fastFill(FillAuthorization calldata, bytes calldata)` — the uniform surface the market and
      off-chain tooling call on any conforming vault, third-party or House.
- [x] **15.3 `ArcaidiaIntentMarket.sol`.** One piece of real state:
      `mapping(bytes32 => address) filledBy` (`address(0)` = unclaimed, winning vault otherwise —
      not a bool, per the doc's own flagged gap: `SettlementReceiver` needs to know *which* vault
      to reimburse, not just that the intent is claimed).
      `claimIntent(bytes32 intentId, uint256 outputAmount, uint256 feeAmount)`: reverts if already
      claimed, otherwise marks `filledBy[intentId] = msg.sender` atomically. The market never
      touches a token — no transfers, no balances.

      **Found while implementing, not resolved in the design doc: the market cannot itself verify
      "the bid satisfies the intent's own `maxFeeBps`/`deadline`" against ground truth.** The
      intent's user-specified `maxFeeBps` and its own deadline are only ever created on the
      *source* chain (`ArcaidiaIntentRouter`'s `IntentCreated` event); nothing on the destination
      chain — where the market and `claimIntent` live — has independent on-chain access to them.
      `FillAuthorization` (what the vault already has) doesn't carry them either, and its byte
      layout is deliberately frozen (§2 of the design doc — a cross-language hash-parity test
      depends on it), so it's not the place to add them. Today this is enforced purely off-chain,
      by each agent's own `evaluateIntent` before it signs anything — the trust model this whole
      protocol already runs on. **Deferred to WP-16.1**, where the real call site (what data the
      vault actually has when it calls the market) gets decided concretely, rather than guessed at
      here. WP-15's `claimIntent` therefore does *not* take `maxFeeBps`/`deadline` parameters.
- [x] **15.4 Pre-settlement check, centralised.** `claimIntent` also reverts if
      `SettlementReceiver.isSettled(intentId)` is already true (mirrors the existing
      `ISettlementCheck` guard in `ArcaidiaLiquidityVault.fastFill`) — one central check instead of
      every vault re-deriving it, closing the same "late fill double-pays" gap WP-10 fixed for the
      single-vault case.

## Tests

- First-valid-fill: two competing calls for the same `intentId`, only the first succeeds, the
  second reverts, `filledBy` reflects the winner.
- Rejects a claim for an intent `SettlementReceiver` already reports settled.
- The market never calls into any token contract — assert via a mock ERC-20 with a reverting
  fallback for any unexpected call.
- Fuzz: whichever caller claims first wins regardless of `outputAmount`/`feeAmount`/caller identity;
  a second claim for the same `intentId` always reverts regardless of who or what values.

## Acceptance gate

A unit test suite proves: two independent (mock) vaults race for one intent, exactly one wins,
`filledBy` names it correctly, and an intent `SettlementReceiver` already reports settled cannot be
claimed by anyone. No contract in this WP moves a token.

**Gate met 2026-09-10.** `ArcaidiaIntentMarket.sol` + `IArcaidiaSolverVault.sol` +
`IntentOpportunity` (in `ArcaidiaTypes.sol`), 7 new tests (`test/ArcaidiaIntentMarket.t.sol`), full
contracts suite still green at 291/291 (was 284 before this WP).
