# WP-15 — IntentMarket contract + IArcaidiaSolverVault interface (M15)

**Objective:** the on-chain arbitrator that lets many independently-owned vaults compete for the
same intent, first-valid-fill, with no auction clock and no window for a losing bid to be
front-run into a winning one.

**Depends on:** WP-02 (vault safety), WP-05 (fill authorization — `FillAuthorizationLib` reused
verbatim). **Blocks:** WP-16. **Stack:** Foundry, `contracts/src`.

**Design source:** `work-packages/WP-INTENT-MARKET.md` §2–4. Read that first; this WP is its
contract half made concrete.

## Sub-tasks

- [ ] **15.1 `IntentOpportunity` struct.** `intentId`, `sourceChainId`, `destinationChainId`,
      `recipient`, `inputAmount`, `maxFeeBps`, `deadline`, `consumed` — the on-chain-readable half
      of `Intent`. Lives in `contracts/src/libraries/ArcaidiaTypes.sol` alongside
      `FillAuthorization`.
- [ ] **15.2 `IArcaidiaSolverVault` interface.** At minimum `quote(IntentOpportunity) view` and
      `fastFill(FillAuthorization calldata, bytes calldata)` — the uniform surface the market and
      off-chain tooling call on any conforming vault, third-party or House.
- [ ] **15.3 `ArcaidiaIntentMarket.sol`.** One piece of real state:
      `mapping(bytes32 => address) filledBy` (`address(0)` = unclaimed, winning vault otherwise —
      not a bool, per the doc's own flagged gap: `SettlementReceiver` needs to know *which* vault
      to reimburse, not just that the intent is claimed).
      `claimIntent(bytes32 intentId, uint256 outputAmount, uint256 feeAmount)`: reverts if already
      claimed, reverts if the bid violates the intent's own `maxFeeBps`/`deadline`, otherwise marks
      `filledBy[intentId] = msg.sender` atomically. The market never touches a token — no
      transfers, no balances.
- [ ] **15.4 Pre-settlement check, centralised.** `claimIntent` also reverts if
      `SettlementReceiver.isSettled(intentId)` is already true (mirrors the existing
      `ISettlementCheck` guard in `ArcaidiaLiquidityVault.fastFill`) — one central check instead of
      every vault re-deriving it, closing the same "late fill double-pays" gap WP-10 fixed for the
      single-vault case.

## Tests

- First-valid-fill: two competing calls for the same `intentId`, only the first succeeds, the
  second reverts, `filledBy` reflects the winner.
- Rejects a bid above the intent's own `maxFeeBps` or past its `deadline`, even from the only bidder.
- Rejects a claim for an intent `SettlementReceiver` already reports settled.
- The market never calls into any token contract — assert via a mock ERC-20 with a reverting
  fallback for any unexpected call.
- Fuzz: `outputAmount`/`feeAmount` never bypass the intent's own constraints regardless of caller.

## Acceptance gate

A unit test suite proves: two independent (mock) vaults race for one intent, exactly one wins,
`filledBy` names it correctly, and a bid violating the user's own stated ceiling or deadline is
rejected regardless of who submits it. No contract in this WP moves a token.
