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

- [x] **21.1 Buildable v1: derive participants from `IntentClaimed` history.**
      `ParticipantRegistry` (`packages/relay/src/participant-registry.ts`) queries the Nest —
      `SELECT DISTINCT vault FROM fills` — the same query, and the same table, `use-vaults.ts`'s
      frontend directory discovery already reads, rather than a second independent RPC log query
      the Relay would have to keep in sync with it. `refresh()` re-derives the set from scratch
      (never merges), so a vault that stops winning eventually falls back out. **Known limitation,
      stated plainly, not hidden:** a vault that has joined but never yet won a single race is
      invisible to this until its first win. Acceptable for v1; flagged for 21.2.
- [ ] **21.2 (optional, if time allows) Explicit registration.** A `registerVault(address)` call
      and `VaultRegistered` event on the market, so a vault shows up the moment it joins, not the
      moment it first wins. A real, small contract change — new deployment, since the market has
      no upgrade path either. Not required for 21.1's acceptance gate; **not built in this pass** —
      the market still has no registry, and this stays a real, separate, deferred change.
- [x] **21.3 Substreams consumer in the Relay — scoped to what's provably real today.**
      `FixtureVaultFlowSource` (`packages/relay/src/vault-flows/fixture-source.ts`) parses
      Substreams' own `substreams run -o json` CLI output verbatim — the exact file WP-ERC4626-
      SUBSTREAMS.md's live verification already committed
      (`substreams/erc4626-vault-flows/verification/sepolia-block-11675763.json`), not a
      hand-written fixture — against the `VaultFlowSource` port (`vault-flows/types.ts`).
      **Honestly scoped, not silently downgraded:** no JS Substreams gRPC client exists anywhere
      in this codebase, and building one untested, live, against a real subscription was a real
      risk of unbounded time for no guaranteed result. `VaultFlowSource` is the seam a live
      subscriber substitutes into later, unchanged, exactly like `ObservationProvider`/
      `SettlementAdapter` elsewhere — `filterKnownParticipants`/`filterForVault`
      (`vault-flows/filter.ts`) and `VaultFlowsService` (`vault-flows/service.ts`) never know or
      care which `VaultFlowSource` they're given. **Deferred, stated plainly:** swapping the fixture
      source for a live gRPC subscription behind the same interface.
- [x] **21.4 Relay API surface.** `GET /v1/vault-flows/{vault}` (`packages/relay/src/server.ts`),
      wired through `VaultFlowsService`; reports `501` — plainly, not a bare `404` that reads as
      "wrong URL" — when the entrypoint has no `vaultFlows` configured (`RelayServerOptions.
      vaultFlows` stays `undefined` unless both `VAULT_FLOWS_NEST_ENDPOINT` and
      `VAULT_FLOWS_FIXTURE_PATH` are set — `entrypoint/config.ts`, validated together-or-neither).
      Never raw Substreams access from the frontend — the browser only ever calls this Relay
      endpoint. Fixed a real bug caught by writing the first real (non-mocked) test against this
      route: `VaultFlowEvent.assets`/`shares` are `bigint`, and plain `JSON.stringify` throws
      `TypeError: Do not know how to serialize a BigInt` on those — `send()` now uses the same
      bigint-to-string `JSON.stringify` replacer `packages/agent/src/entrypoint/quote-server.ts`
      already established for the identical reason.
- [x] **21.5 Document the asymmetry.** Arc has zero Firehose/Substreams support (checked directly
      against The Graph's registry — not a gap, a hard constraint). `parseVaultFlowsPath`'s doc
      comment on the `/v1/vault-flows/{vault}` route (`packages/relay/src/server.ts`) states it
      outright: no `chainId` segment, because there is only ever one chain this can mean. A vault's
      Ethereum-side flows come from this module; its Arc-side flows still come from the existing
      project-specific subgraph/Nest tables. One vault, two different data sources — never
      presented as one unified feed.

## Tests

- [x] Given a raw decoded batch containing both known-participant and stranger vault addresses,
      only the participants' flows reach the Relay's API — the core cross-reference, happy and sad
      path (`packages/relay/test/vault-flows/filter.test.ts`, `test/vault-flows/service.test.ts`).
- [x] A vault that has never appeared in the Nest's fill history is correctly excluded, even if it
      is a perfectly valid ERC-4626 vault elsewhere — proven at the filter, the service, and the
      real HTTP route (`test/vault-flows/service.test.ts`'s "a stranger's vault is excluded even
      though it's a valid ERC-4626 vault elsewhere", `test/server.test.ts`).
- [x] Replay against the already-committed real fixture
      (`substreams/erc4626-vault-flows/verification/sepolia-block-11675763.json`) as a
      known-answer test, not a synthetic one — decodes all four real deposits and asserts
      Arcaidia's own vault's exact real values (`assets: 100_000_000n`, `shares:
      100_000_000_000_000n`, real sender/block) against numbers independently cross-checked in
      WP-ERC4626-SUBSTREAMS.md's own verification (`test/vault-flows/fixture-source.test.ts`).
- [x] `ParticipantRegistry` derives, and correctly replaces (not merges) on refresh, its
      participant set from the Nest — case-insensitively (`test/participant-registry.test.ts`).
- [x] The real HTTP route: `501` when unconfigured, `200` with only the requested vault's
      known-participant events (serialized correctly despite the bigint fields) when configured
      (`test/server.test.ts`).
- If 21.2 is built: a vault appears immediately on registration, before any fill. **Not
  applicable — 21.2 was not built in this pass.**

## Acceptance gate

Given real Substreams output for a block containing both Arcaidia-market participants and
unrelated ERC-4626 vaults, the Relay's API exposes only the participants' flows — proven against
the real committed fixture, not a mock — and the Ethereum-only scope is documented, not implied
to cover Arc. **Met, as scoped:** proven end-to-end over real HTTP against the real committed
fixture (`test/server.test.ts`'s WP-21.4 suite). The one piece explicitly *not* covered by this
gate — a live Substreams gRPC subscription in place of the fixture source — remains real, scoped,
deferred work behind the `VaultFlowSource` seam, not something this pass claims to have done.
