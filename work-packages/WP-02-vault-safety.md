# WP-02 — Bidirectional vault safety (M2)

**Objective:** prove that LP principal cannot leave the vault outside defined policy, in either
direction. This is the work package that protects the money.

**Depends on:** WP-01. **Blocks:** WP-05.
**Stack:** Foundry.

## Sub-tasks

- [ ] **2.1 Policy parameters** on the vault: `reserveFloorBps`, `maxFillAmount`,
      `maxOutstandingExposure`, `maxFeeBps`, `paused`, `authorisedSigners` (set), owner/guardian
      roles. All settable only by owner, all emitting events.
- [ ] **2.2 Consumed-intent map.** `mapping(bytes32 => bool) consumed` marked **before** the
      transfer (checks-effects-interactions). Agent `nonce` tracked separately.
- [ ] **2.3 Liquidity accounting.** `availableLiquidity = liquidBalance - reserveFloor`. A fill that
      would push below the floor reverts. Outstanding exposure increments on fill and decrements on
      canonical reimbursement. `totalAssets()` = liquid balance + outstanding exposure.
- [ ] **2.3b ERC-4626 safety** (DECISIONS.md D1): first-depositor inflation/donation attack,
      rounding direction on `deposit`/`mint`/`withdraw`/`redeem` (always against the redeemer),
      and redemption while a fill is outstanding — an LP must not be able to exit cheaply by
      redeeming before the receivable lands.
- [ ] **2.4 Fee bounds.** `outputAmount = inputAmount - feeAmount`; `feeAmount` must satisfy both
      protocol max and the user's `maxFeeBps` carried in the authorization. Zero-fee and
      max-fee edges both tested.
- [ ] **2.5 Pause & guardian.** Paused vault rejects all fills; deposits/withdrawals for LPs
      behave per an explicit, documented decision (recommend: withdrawals allowed, fills blocked).
- [ ] **2.6 Bidirectional test matrix.** Every scenario below runs with Ethereum-as-destination
      and with Arc-as-destination, driven by config — not by duplicated test files.
- [ ] **2.7 Fuzz/invariant tests.** Foundry invariant: `totalAssets()` never decreases except
      through an authorised fill's fee accounting or an LP redemption; and share price never
      decreases outside a realised loss.

## Test matrix (each × both directions)

| Scenario | Expected |
| --- | --- |
| LP deposit / partial redeem / full redeem | Shares and assets exact, rounding never favours the redeemer |
| First depositor donates assets to inflate share price | Later depositor is not diluted to zero |
| Redeem while a fast fill is outstanding | Priced against `totalAssets()` including the receivable |
| Fill below reserve floor | Revert |
| Fill above `maxFillAmount` | Revert |
| Fill breaching `maxOutstandingExposure` | Revert |
| Fee above protocol max | Revert |
| Fee above user `maxFeeBps` | Revert |
| Duplicate `intentId` | Revert (second attempt) |
| Reused agent nonce | Revert |
| Unauthorised signer | Revert |
| Paused vault | Revert |
| Insufficient liquidity | Revert, no partial fill |
| Valid fill | Recipient balance += `outputAmount`, exposure += `inputAmount`, intent consumed |
| Reentrant token callback during fill | No double spend |

## Acceptance gate

No LP principal can leave outside defined policy. Both ETH→Arc and Arc→ETH matrices pass. Fuzz and
invariant runs green.

## Traps

- Marking `consumed` after the transfer. Classic reentrancy hole.
- Computing available liquidity from `balanceOf` alone, ignoring outstanding exposure.
- Writing the matrix twice (one file per direction) instead of parameterising by config — that
  is the same duplication the spec forbids in the contracts.
