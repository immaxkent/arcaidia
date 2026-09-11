# Architecture decisions

One entry per decision that constrains later work. Recorded when taken, with the
reasoning and the risk accepted, so nobody re-litigates it from memory.

---

## D1 — The LiquidityVault is an ERC-4626 tokenized vault
**Date:** 2026-09-04 · **Status:** accepted · **Affects:** WP-01, WP-02, WP-08

LPs hold shares. `totalAssets()` is the liquid balance **plus** principal advanced
and awaiting canonical reimbursement.

**Why:** the receivable has to be counted, otherwise an LP could redeem mid-fill at
an unfairly cheap price and leave the remaining LPs carrying the exposure.
Share-based accounting makes the fee visible as a rising share price, which is a
better demo than a balance that dips and recovers. It also opens The Graph P1 via
a contributed composable Substreams module for ERC-4626 vault flows — the example
that prize names explicitly.

**Risk accepted:** share rounding and donation/inflation attack surface. WP-02 must
test both: first-depositor inflation, rounding direction on deposit and redeem,
and redemption while a fill is outstanding.

**Consequence:** available liquidity for a fill is the *liquid balance* minus the
reserve floor — never `totalAssets()`. A receivable cannot be advanced twice.

## D2 — The vault authenticates a recovered EIP-712 signer
**Date:** 2026-09-04 · **Status:** accepted · **Affects:** WP-02, WP-05, WP-09

`fastFill` recovers the signer from the EIP-712 signature and checks it against an
allowlist. It does not authenticate `msg.sender`.

**Why:** the authorization stays portable, any relayer can submit it, and the local
signer and the Circle Agent Wallet sit behind one interface with no vault change
between them. Matches the specification as written. Q4 confirmed Circle Agent
Wallets can sign EIP-712 typed data and return a raw signature.

**Consequence:** `AgentAuthority` in `packages/domain/src/ports.ts` is narrowed to
the signing shape; `ExecutingAuthority` has been removed.

## D3 — The Circle agent wallet is assumed to be an EOA
**Date:** 2026-09-04 · **Status:** accepted, unverified · **Affects:** WP-05, WP-09

Build for `ecrecover`. Confirm the account type at WP-09.

**Risk accepted:** if the wallet is provisioned as a Smart Contract Account, its
signature needs EIP-1271 verification instead, which changes the vault's
verification path and the signer implementation. Circle supports both account
types, and SCA wallets additionally use lazy deployment — signing before first
deployment fails.

**Mitigation:** provision the wallet as an EOA when it is created. If that proves
impossible, the vault gains an EIP-1271 branch; the `AgentAuthority` port itself
does not change, because it already returns an opaque signature.

## D4 — V1 targets Ethereum Sepolia ⇄ Arc testnet
**Date:** 2026-09-04 · **Status:** accepted · **Affects:** everything

**Why:** the only environment where the bidirectional CCTP path exists today. Arc
mainnet launches 2026-09-16 and Circle lists no Arc mainnet CCTP deployment.

**Consequence:** Arc P4 asks for mainnet readiness by 2026-09-30. Once Arc mainnet
is live, check whether CCTP V2 ships with it. If so, deploying is an edit to
`packages/domain/src/config/chains.ts` plus a CREATE2 deployment — no code change,
because direction and asset are already configuration. That config diff and the
predicted deterministic addresses are the evidence for "deployment-ready" either way.

---

## Deferred, not yet decided

- **The Graph P1 route.** ERC-4626 + Substreams module (D1 enables it) and/or
  Subgraph MCP composition. Decide before WP-08.
- **x402 per-query payment** for Graph queries (Graph P2 offers it; the spec defers
  x402 to V3). Decide at WP-08.
- **Privy P1** (B2B) via an LP treasury console. Scope creep unless WP-11 lands early.
- **CCTP forwarding service** — whether it can deliver straight to
  `SettlementReceiver`. WP-01 spike.
- **Q9 confirmation policy** and **Q10 fee split**.

---

## D5 — Intent schema is versioned in the preimage; v1.1 adds `tokenOut`/`targetMinOut`
**Date:** 2026-09-11 · **Status:** accepted · **Affects:** WP-24, WP-25, WP-27, WP-28, WP-30

`intentVersion` (uint8, = 1) is the first field of the `Intent` struct and of the `intentId`
preimage; `tokenOut` (address(0) = destination settlement asset) and `targetMinOut` (0 unless
`tokenOut` set) are appended. One typehash string, one Solidity and one TypeScript
implementation, shared fixtures.

**Why:** the brief wants no second cross-chain metadata migration when Uniswap lands. Reserving
the fields *and* the version now means Line 1 merges with zero schema change, and any future
layout can be told apart by its first byte.

**Risk accepted:** v1 and v1.1 ids differ for the same economic terms. Acceptable because the
router is redeployed and the old one only ever settles its own in-flight intents.

## D6 — The user's `maxFeeBps` is enforced on chain by recomputing the intent id
**Date:** 2026-09-11 · **Status:** accepted · **Affects:** WP-26, WP-28 · **Supersedes:** WP-INTENT-MARKET.md §6 (2026-09-11) "deliberately not built"

`fastFill(Intent intent, FillAuthorization auth, bytes sig)`: the vault recomputes
`IntentLib.computeIntentId(intent)`, requires it to equal `auth.intentId`, and enforces
`feeAmount <= amount * intent.maxFeeBps / 1e4` plus consistency (`recipient`, `amount`,
`sourceChainId`, `destinationChainId == block.chainid`, `deadline`).

**Why:** the id is what the signed authorization, the market claim and the CCTP hook all bind
to. A solver that lies about `maxFeeBps` changes the id, which then matches no real intent and
is never reimbursed. `FillAuthorization` stays byte-identical (EIP-712 lock kept; Circle Agent
Wallet untouched).

**What this is not:** a proof the intent exists on the source chain. That remains the
verified-observation trust model (`README.md`, "Trust assumption").

## D7 — Vault fee policy: four utilisation tiers, set at initialize, immutable, enforced on chain
**Date:** 2026-09-11 · **Status:** accepted · **Affects:** WP-26, WP-28, WP-30, WP-32

`FeePolicy {base, mid, high, critical fee bps; mid, high, critical threshold bps}`, validated at
`initialize`, no setter. `currentFeeBps()` / `quoteFee(amount)` views. `fastFill` requires
`feeAmount <= amount * currentFeeBps() / 1e4` at pre-fill utilisation. The solver's `RiskPolicy`
stops pricing; it reads the vault.

**Why:** the brief: the vault, not the solver, is the source of truth for fees; two vaults may
differ; fees must be observable and deterministic. Step tiers are explainable to an LP and a judge.

**Consequence:** the vault's `maxFeeBps` fill limit is removed (the policy's `criticalFeeBps` is
the ceiling, bounded by the market's universal 150 bps). `maxFillBps`/`maxExposureBps` move to
`initialize` too, but stay owner-adjustable as pure risk knobs.

## D8 — Canonical association via CCTP V2 `hookData`; receiver is the `destinationCaller`
**Date:** 2026-09-11 · **Status:** accepted · **Affects:** WP-25, WP-26, WP-28, WP-31

Router → `ISettlementInitiator.initiateSettlement(..., hookData)` with
`hookData = abi.encode(uint8 1, bytes32 intentId, address recipient)`; `CircleCCTPInitiator`
uses `depositForBurnWithHook` and sets `destinationCaller = destinationReceiver`.
`SettlementReceiver.settleWithProof(message, attestation)` (permissionless) calls
`receiveMessage` itself and routes by the attested `intentId`/`recipient`.

**Why:** the attestation covers `hookData`, so the destination association is cryptographic, not
reporter-asserted; setting `destinationCaller` removes the "someone else called
`receiveMessage` first" race and makes settlement one transaction. Verified against
`circlefin/evm-cctp-contracts` (`BurnMessageV2` hookData offset 228; `MessageV2` body offset 148).

**Risk accepted:** only our receiver can mint. Mitigated by `settleWithProof` needing no key, by
keeping reporter `settle` as an owner recovery path, and by parking funds (`HELD_FOR_VAULT`) if
a winning vault's `recordReimbursement` reverts.

## D9 — Destination-trade execution is a vault seam, not a vault redeploy
**Date:** 2026-09-11 · **Status:** accepted · **Affects:** WP-26, WP-34, Line 1

The v2 vault carries an owner-settable `ISwapAdapter swapAdapter` (default `address(0)`). On a
fill with `intent.tokenOut != 0` and an adapter set, the vault approves and calls
`swapExactInput(usdc, tokenOut, outputAmount, targetMinOut, recipient)` in `try/catch`; on
revert or no adapter it delivers USDC to `recipient` (the brief's fallback). Interface frozen in
WP-24; implementation delivered by Line 1.

**Why:** avoids a second vault redeploy when Uniswap merges; keeps Uniswap out of the canonical
settlement path; core never learns Uniswap internals.

## D10 — Vaults are created through `ArcaidiaVaultFactory`; the directory is its events
**Date:** 2026-09-11 · **Status:** accepted · **Affects:** WP-26, WP-27, WP-30, WP-31

`createVault(owner, salt, reserveFloorBps, maxFillBps, maxExposureBps, FeePolicy, label)` deploys
the standard vault via CREATE2 (salted by `owner`+`salt`), wires the chain's market and receiver,
transfers ownership, emits `VaultCreated`. The House Vault is created the same way. The subgraph
gains a factory data source + vault template; the frontend's "derive vaults from fills" hack goes.

**Why:** the Earn page already assumes exactly this; multi-vault indexing needs a discovery
event; independent operators need no Arcaidia key at any step (WP-20.4).

## D11 — Only factory-created standard vaults may claim an intent
**Date:** 2026-09-11 · **Status:** accepted · **Affects:** WP-26, WP-28, WP-31 · **Found while:** designing `settleWithProof`

`ArcaidiaIntentMarket.claimIntent` was callable by anyone. `SettlementReceiver` reimburses the
market's winner by approving it and calling `recordReimbursement` — so any contract that
claimed an intent id could pull the canonical funds when they landed, and an EOA claimant
would leave them unroutable. The market now takes an `IVaultRegistry` (the factory) at
construction and reverts `NotAFactoryVault` for any other claimant. `SettlementReceiver`
additionally wraps the reimbursement in `try/catch`, parking funds as `HELD_FOR_VAULT` with a
permissionless `retryHeld`, so canonical funds are never trapped even by a pathological winner.

**Why this and not "verify the claim against the CCTP deposit":** at claim time nothing from
CCTP exists on the destination chain — the attested hook arrives minutes later, and the brief
forbids gating the fast fill on attestation. What the CCTP deposit *does* prove, once it lands,
is the intent (`intentId`, `recipient`); who won is the market's own on-chain record. Both are
what `settleWithProof` routes by (D8).

**Still permissionless:** anyone creates a standard vault through the factory with no Arcaidia
key; the factory embeds the vault's init code, so "a vault the market trusts" and "a vault
whose `recordReimbursement` only accepts funds for intents it actually paid" are the same thing
by construction.

**Recorded alternative (not built, ~1 day):** market-executed payout — `claimIntent` pulls the
output from the claimant and pays the recipient itself, so claimed ⇔ paid and reimbursement is a
plain transfer to whoever the market debited. Fully allowlist-free, but moves the payout and the
swap-delivery seam (D9) out of the vault and re-opens the fill path's accounting/reentrancy
analysis. Revisit if non-standard vault code ever needs to compete.
