# The intent market — permissionless solver vaults (post-V1, parked)

**Status:** designed, not built. **Depends on:** nothing in V1 — see §5. **Blocks:** nothing.
**Sits:** after WP-13 (freeze), before or alongside V2 (Uniswap) / V3 (Hedera/x402).

## 1. The idea

V1 has one solver, authorised by allowlist. This is the natural extension raised while
scoping the x402 work: **anyone can deploy their own `ArcaidiaLiquidityVault`, fund it with
their own capital, set their own risk parameters, and compete to fill intents.** Arcaidia
becomes a market Solvers plug into rather than a service Arcaidia alone operates.

This document exists so the design is captured precisely, and so nobody has to re-derive it
under time pressure later. **None of it is built. None of it needs to be, for V1.**

## 2. Two structs, not one

**`FillAuthorization`** (exists today, unchanged in shape) — *"execute this exact fill."*
Signed, `ecrecover`-verified, carries the chain-of-custody fields (`sourceChainId`,
`sourceTxHash`) binding it to one verified source commitment. This is reused as-is for the
winning bid's execution instruction.

**A new `IntentOpportunity` struct** (does not exist yet) — *"here's what's biddable, and
what a valid bid must satisfy."* The on-chain-readable half of `Intent` plus a `consumed`
flag: `intentId`, `sourceChainId`, `destinationChainId`, `recipient`, `inputAmount`,
`maxFeeBps`, `deadline`, `consumed`. A solver's off-chain agent reads this via a view
function before constructing a bid.

**Why not one struct.** `FillAuthorization`'s byte layout is locked by a cross-language test —
`packages/domain/src/eip712.ts` and `contracts/src/libraries/FillAuthorizationLib.sol` are
asserted to hash identically, and every signature ever produced is over that exact digest.
Adding a `vault` field to say who is bidding would break that lock and invalidate every
existing signature. It also isn't necessary: which vault is bidding is `msg.sender` when
that vault calls into the market, exactly as `sourceChainId` is already read from
`block.chainid` rather than hardcoded. Direction is data; solver identity is context, not
struct content, for the same reason.

## 3. The market never holds money

`ArcaidiaIntentMarket` is a pure arbitrator: one piece of state,
`mapping(bytes32 => bool) consumed`, and the check that a bid satisfies the user's own
`maxFeeBps` and `deadline`. It never touches a token.

A vault's `fastFill()` gains one internal line, added before its existing logic:

```solidity
market.claimIntent(auth.intentId, auth.outputAmount, auth.feeAmount);
// reverts if another vault already won, or this bid violates the user's constraints —
// otherwise the intent is now globally consumed and this vault has won it atomically.

// everything below is today's fastFill, unchanged: allowlist check, replay, caps, transfer.
_recordFastFill(auth.intentId, auth.recipient, auth.outputAmount);
```

This is **first-valid-fill**: no auction clock, no sealed-bid reveal phase, no window for a
losing bidder's transaction to be front-run into a winning one. It is the simplest of the
mechanisms considered (Dutch auction, sealed quotes, request-for-quote window, first-valid-fill)
and simplest for a concrete reason — nothing about it can go wrong live, which matters more
than optimal price discovery for a first permissionless version.

## 4. Standardisation is an interface, not a new library

`FillAuthorizationLib` already is the shared library — canonical EIP-712 hashing, used
identically by every vault today. A permissionless deployment additionally needs a shared
**interface**, `IArcaidiaSolverVault`, so the market and any off-chain tooling can call an
arbitrary third-party vault uniformly — at minimum a `quote(IntentOpportunity) view` and the
existing `fastFill`. Any conforming deployment can join without Arcaidia's permission; the
comparison worth keeping in mind is ERC-4626 itself — one interface, permissionless
deployment, integrators compose against any conforming vault. Fitting, since our vault
already is one.

## 5. What this requires of V1 — checked, not assumed

**Nothing.** Verified against the current contracts before writing this:

- `isAuthorisedSigner` is already `mapping(address => bool)`, not `address public solver` —
  confirmed in `ArcaidiaLiquidityVault.sol`. Adding Solver B/C/D today is
  `setAuthorisedSigner(newSolver, true)`; no migration.
- `fastFill(FillAuthorization calldata, bytes calldata)`'s external signature does not change
  when the market call is added — the market call is internal implementation, not part of the
  ABI. Nothing that imports this function's shape (the frontend, the domain package, the
  solver) needs to change when this ships.
- `Intent`, `AgentDecision`, `VaultState` — everything the frontend's data contracts (§7 of
  `docs/frontend-spec.md`) depend on — are untouched by everything in this document.

**One real code change, when this is actually built, not before.** `intentFilled[intentId]`
currently lives in each vault's own storage as the local source of truth. When the market
arrives, authority over that mapping moves to the market; the vault's own copy becomes a
cache reconciled against it. That is a genuine implementation change to the vault at that
time — but still not an ABI change, so it still does not touch the frontend or the solver's
data contracts.

**Conclusion:** this can be built any time after WP-13, including after V2/V3, without
disturbing anything shipped before it. Nothing needs to be done now to keep the door open —
it already is.

## 6. Deliberately not decided here

- Whether `maxFeeBps` alone is a sufficient bid-selection criterion, or whether the market
  should weigh latency/reliability/liquidity confidence as the ChatGPT-drafted model proposed.
  First-valid-fill sidesteps this for v1 of the market: any bid meeting the user's stated
  ceiling wins by being first, full stop. Scoring across multiple live bids is a genuine
  future refinement, not a blocker to shipping the simple version.
- Solver reputation, historical performance, dynamic pricing — V2.5+ in the roadmap this
  document's source sketched. Out of scope until the simple market is live and used.
- Whether x402 gates *bidding itself* (access to see an opportunity) or only gates *agents
  buying services from other agents while solving* (data, routing, risk assessment). This
  document assumes the latter, for the reason recorded in WP-03's x402 scope: taxing
  competition to fill a user's order has no clear anti-spam justification here, since the
  intents are read openly rather than broadcast at volume. If Sybil/spam pressure on the
  opportunity feed becomes real, revisit.
