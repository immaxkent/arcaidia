# WP-21 — Substreams-backed vault observability, cross-referenced (M21)

**Objective:** turn the generic, published `erc4626-vault-flows` Substreams module (landed on
`main` from the parallel Graph-P1 fork — see `WP-ERC4626-SUBSTREAMS.md`) into something the
product can actually show: deposit/withdraw flows for vaults genuinely participating in
Arcaidia's intent market, not any ERC-4626 vault on Ethereum.

**Depends on:** WP-15 (the market — `IntentClaimed` is the only participant signal that exists
today), WP-18 (the Relay — the server-side home this needs; a browser cannot consume a Substreams
gRPC stream directly). **Blocks:** nothing — additive, not on the critical path to WP-20's gate.
**Stack:** the Relay service (Node/TypeScript, alongside WP-18's telemetry endpoints), a
Substreams gRPC client, `SUBSTREAMS_API_KEY` (already provisioned, separate credential from
`GRAPH_API_KEY`).

## What already exists — do not rebuild

`substreams/erc4626-vault-flows/` — published, live, public at
`https://substreams.dev/packages/erc4626-vault-flows/v0.1.1`. Decodes standard `Deposit`/
`Withdraw` events from *any* address emitting them, matched by event signature, never by
allowlist. Live-verified: pointed at real Sepolia block 11675763, correctly decoded four vaults'
deposits, three of which the project has never seen. This module needs no changes — it is
deliberately generic and stays that way. `substreams/vault-flows-subgraph/` is a dead end (Studio
removed direct-Substreams-to-subgraph support platform-wide, for every chain) — do not extend it.

## The real gap: no participant registry exists yet

`ArcaidiaIntentMarket` has `filledBy: mapping(bytes32 => address)`, keyed by intent, not a list of
participating vaults. There is no `registerVault()` and no `VaultRegistered` event — any
conforming vault can call `claimIntent()` without ever announcing itself first. So "cross-reference
against the registry" is not yet buildable as a clean lookup; the only real signal is *which
addresses have ever appeared as the `vault` field in an `IntentClaimed` event*.

## Sub-tasks

- [ ] **21.1 Buildable v1: derive participants from `IntentClaimed` history.** The Relay indexes
      `ArcaidiaIntentMarket`'s `IntentClaimed` events (direct RPC log query or its own light
      subgraph — reuse whichever the Relay already needs for WP-18) into a known-participant
      address set. **Known limitation, stated plainly, not hidden:** a vault that has joined but
      never yet won a single race is invisible to this until its first win. Acceptable for v1;
      flagged for 21.2.
- [ ] **21.2 (optional, if time allows) Explicit registration.** A `registerVault(address)` call
      and `VaultRegistered` event on the market, so a vault shows up the moment it joins, not the
      moment it first wins. A real, small contract change — new deployment, since the market has
      no upgrade path either. Not required for 21.1's acceptance gate; do 21.1 first regardless.
- [ ] **21.3 Substreams consumer in the Relay.** Subscribes to `map_vault_flows` on Ethereum
      (Sepolia today; `mainnet` is fully supported by the module too, matching WP-INTENT-MARKET's
      own "config-only" mainnet story once Arc mainnet and a real deploy exist). Filters every
      decoded `Deposit`/`Withdraw` to just the known-participant set from 21.1 before it reaches
      any API response — a stranger's vault deposit is discarded, not exposed.
- [ ] **21.4 Relay API surface.** A new endpoint (e.g. `GET /v1/vault-flows/{vault}`) serving the
      filtered stream — never raw Substreams access from the frontend, per the handoff's own
      constraint (no browser-side gRPC client, needs a server-side intermediary with the API key).
- [ ] **21.5 Document the asymmetry.** Arc has zero Firehose/Substreams support (checked directly
      against The Graph's registry — not a gap, a hard constraint). A vault's Ethereum-side flows
      come from this module; its Arc-side flows still come from the existing project-specific
      subgraph. One vault, two different data sources, stated plainly wherever this ships — never
      silently presented as one unified feed.

## Tests

- Given a raw decoded batch containing both known-participant and stranger vault addresses, only
  the participants' flows reach the Relay's API — the core cross-reference, happy and sad path.
- A vault that has never appeared in `IntentClaimed` is correctly excluded, even if it is a
  perfectly valid ERC-4626 vault elsewhere.
- Replay against the already-committed real fixture
  (`substreams/erc4626-vault-flows/verification/sepolia-block-11675763.json`) as a known-answer
  test rather than a synthetic one.
- If 21.2 is built: a vault appears immediately on registration, before any fill.

## Acceptance gate

Given real Substreams output for a block containing both Arcaidia-market participants and
unrelated ERC-4626 vaults, the Relay's API exposes only the participants' flows — proven against
the real committed fixture, not a mock — and the Ethereum-only scope is documented, not implied
to cover Arc.
