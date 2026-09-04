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
