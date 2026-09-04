# WP-02 completion report

**Date:** 2026-09-04 · **Gate:** met · **Next:** WP-04 (see §5 on ordering).

## 1. Gate

> No LP principal can leave outside defined policy. Both ETH→Arc and Arc→ETH
> matrices pass. Fuzz and invariant runs green.

Met. `pnpm test:global` green: **78 domain tests, 218 contract tests run twice**
(once per direction, from configuration rather than duplicated files).

## 2. What was added

| Area | Where | Tests |
| --- | --- | --- |
| `fastFill` entry point | `ArcaidiaLiquidityVault.sol` | 26 (`FastFill.t.sol`) |
| EIP-712 hashing | `FillAuthorizationLib.sol` | 15 + a TypeScript lock |
| Rounding direction | — | 10 (`VaultRounding.t.sol`) |
| Reentrancy | `ReentrantToken.sol` | 7 (`VaultReentrancy.t.sol`) |
| Invariants | `VaultInvariantHandler.sol` | 9 invariants + 2 anti-vacuity tests |

## 3. The safety matrix

Every row runs in both directions.

| Scenario | Result |
| --- | --- |
| LP deposit / partial redeem / full redeem | Exact; rounding never favours the redeemer |
| First depositor donates to inflate share price | Later depositor not diluted; virtual offset holds |
| Redeem while a fast fill is outstanding | Priced against `totalAssets` including the receivable |
| Fill below the reserve floor | Reverts |
| Fill above the single-fill cap | Reverts |
| Fill breaching the exposure cap | Reverts |
| Fee above the protocol ceiling | Reverts; exactly at the ceiling is accepted |
| Inconsistent amounts (`output + fee != input`) | Reverts |
| Duplicate `intentId` | Reverts |
| Reused agent nonce | Reverts |
| Unauthorised or revoked signer | Reverts |
| Tampered recipient, output or intent id | Reverts |
| Signature for the other chain's vault | Reverts |
| Expired authorization (at and after expiry) | Reverts |
| Paused vault | Reverts |
| Insufficient liquidity | Reverts, no partial fill |
| Reentrant token callback during fill | Blocked; outer operation completes once |
| Valid fill | Recipient paid, exposure recorded, intent consumed |

## 4. Findings

**A real bug in `maxRedeem`.** It converted shares → assets → shares, flooring at
both steps, so an LP whose entire position was covered by the liquid balance
still could not redeem all of it — the last fraction of a share was permanently
stranded. Three rounding tests failed with `ExceedsMaxRedeem` for amounts a wei
below the caller's own balance. Fixed to convert only when liquidity is actually
the binding constraint, with three regression tests. This is the first defect the
suite has caught in shipping code rather than test code, and it is the kind that
survives review because every individual operation looks correct.

**Three false-green patterns in test code**, each found by expecting a specific
failure and not getting it:

1. `vm.expectRevert` attaching to the helper's *view* call to the vault rather
   than to `fastFill`. Fourteen tests were passing without ever reaching the
   function under test, and would have stayed green through almost any bug in
   the fill path.
2. The invariant handler swallows failed actions, so a handler incapable of
   succeeding at anything would satisfy all nine invariants while proving
   nothing. Two ordinary tests now assert each action actually moves state.
3. `vault.balanceOf()` inside an argument list consuming a `vm.prank`, so the
   call ran as the test contract.

**The `abi:check` guard fired for the first time**, on `fastFill` changing the
vault ABI. A downstream package would otherwise have compiled against a vault
interface that no longer existed.

## 5. Decisions and open items

**`fastFill` was built here, not in WP-05.** The safety matrix needs an entry
point to test against. WP-05 is now the agent-side signer plus its tamper and
replay coverage — much of which already exists here. Flagged for review twice;
proceeding on it.

**Q10, the fee split, is now load-bearing.** The whole fee accrues to LPs. That
choice is encoded in the share-price invariant and the rounding suite, so
changing it is no longer a one-line edit to vault storage. Still worth a decision
before WP-04 prices anything.

**Reentrancy protection assumes nothing about the asset.** Real USDC has no
transfer hook, but the vault holds a configured IERC20 and V2 widens the asset
set. The suite runs against a token that calls back mid-transfer.

## 6. Note on what comes next

WP-03 is the Privy frontend. It is the one work package in V1 whose acceptance
gate — "a real Privy wallet can create an intent in either direction through the
UI" — cannot be evidenced by an automated suite alone, and it needs a Privy app
id and a browser to verify honestly.

WP-04, the deterministic risk engine, is pure TypeScript, blocks WP-05, and is
fully testable. Proceeding to WP-04 and leaving WP-03 for a session where the
UI can actually be driven and looked at.
