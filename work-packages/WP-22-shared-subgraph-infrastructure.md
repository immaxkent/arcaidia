# WP-22 — Shared, rate-limit-free subgraph infrastructure (M22)

**Objective:** any solver operator — the House Solver, an Arcaidia-run demo solver, or an
independent third party (an ETHGlobal judge spinning up their own, or any future permissionless
participant) — can run `arcaidia-solver` against real observation infrastructure with **zero
Graph account of their own** and without hitting The Graph's free-tier caps. WP-08 built the
*client* that talks to a subgraph; nobody yet decided who hosts the subgraph an unconfigured
solver actually points at. That's the gap this closes.

**Why now:** the demo needs at least three solvers running concurrently (House + two
Arcaidia-run) against Arc testnet's Studio-only tier, which has a hard 3k-query/day ceiling and no
paid option at any solver count. `GraphObservationProvider.pendingIntents()` was already fixed
(2026-09-11) to batch its fill-checks into one aliased request per chain per poll instead of one
per candidate — real, needed, but it does not change the fact that *N solvers polling the same
key* still multiplies query volume by N. The only thing that removes the ceiling is not sharing a
capped key at all.

**Depends on:** WP-08 (`GraphObservationProvider`, the committed subgraph manifests), WP-17.1 (the
`{PREFIX}_LIQUIDITY_VAULT` override-with-committed-default pattern this reuses exactly). **Blocks:**
running more than one solver against Arc testnet today; WP-19 (the solver console needs to know
what `GRAPH_ENDPOINT` value to hand a newly-onboarded operator).

**Stack, as actually built (revised 2026-09-11):** the original plan below was a self-hosted
`graph-node` + Postgres + IPFS stack we would provision. Instead, the Graph rep hosted two
purpose-built indexers ("Nests") himself — one per chain, no key, no limit, CORS open — queried
over **SQL-over-HTTP, not GraphQL**: `GET {endpoint}/sql?q=<SELECT ...>`, with the same entities
`GraphObservationProvider` already reads exposed as SQL views (`pending_intents`, `vault`,
`fills`, `protocol_state`). This is a materially different transport, not a hosting-location
detail, so it gets its own provider (`SqlNestObservationProvider`) rather than pointing
`GraphObservationProvider` at a new URL — see "What got built" below.

## Sub-tasks

- [x] **22.1 The two nests are live.** Both hosted by the Graph rep, seeded from this repo's own
      ABIs, addresses and start blocks — verified live, 2026-09-11:
      `https://hackathon.89.167.109.4.sslip.io/arcaidia-sepolia` and `.../arcaidia-arc`. `/ready`
      on both returns `ready: true` with a `last_block` matching each chain's real current head.
- [x] **22.2 Public reachability confirmed.** HTTPS, no key, CORS open (queryable straight from a
      browser) — confirmed by direct `curl` against both endpoints, not assumed from the rep's own
      description of them.
- [x] **22.3 Committed default endpoint URLs, override-with-fallback.**
      `packages/domain/src/config/chains.ts`'s `ChainConfig` gains a committed `subgraphUrl` per
      chain (the two Nest URLs above), same override-with-fallback shape WP-17.1 already built for
      `{PREFIX}_LIQUIDITY_VAULT`: `SUBGRAPH_URL_{PREFIX}` unset means the committed Nest URL, set
      overrides it for an operator pointing at their own subgraph/indexer instead.
      `packages/agent/src/entrypoint/config.ts`'s `requireUrl`-and-throw for a missing
      `SUBGRAPH_URL_{PREFIX}` is gone — that was the actual "you must already have a subgraph"
      barrier this sub-task closes. `build-dependencies.ts` now wires `SqlNestObservationProvider`
      (below) as the live entrypoint's default observation provider, in place of
      `GraphObservationProvider`.
- [x] **22.4 `.env.example` reflects the new default** — states plainly that `SUBGRAPH_URL_*` is
      optional and unset means Arcaidia's own uncapped indexer.
- [ ] **22.5 A basic external healthcheck, not a dashboard.** Still open: poll each Nest's
      `/ready` and alert if `ready` goes false or the endpoint is unreachable — the point being
      that Arcaidia notices an outage before a demo solver silently halts (WP-08's rule: the
      provider throws rather than reporting an empty world, so today "the solver stopped" is the
      *first* signal, with nobody watching for it upstream).
- [ ] **22.6 WP-17's onboarding docs get one sentence added** — still open, small: an independent
      operator should see explicitly that no Graph account is required to run the reference
      runtime.

### What got built: `SqlNestObservationProvider` (`packages/agent/src/observation/`)

Same `ObservationProvider` contract, same rules as `GraphObservationProvider` (two chains merged
on `intentId`, `observedAt` from the indexer's own freshness signal — here, `/ready`'s
`last_poll_unixtime` — never the local clock, failures throw rather than reporting an empty
world), SQL-over-HTTP instead of GraphQL. `pendingIntents()`'s fill-check is batched one query per
chain regardless of candidate count, same fix and same reasoning as the GraphQL provider's own
2026-09-11 batching fix.

**A real bug found and worked around, not papered over.** `pending_intents`/`intents`' `nonce`
column returns `NULL` on every row — confirmed live: the raw underlying event table
(`intent_router__intent_created`) carries the correct value, so the authored view's mapping is
dropping it (best guess: it's reading the `_dec` decimal companion, which the Nest's own schema
docs say overflows to `NULL` above 38 digits — Arcaidia's nonces are full-width random uint256s,
always over that). This matters because `verify-source.ts` independently re-checks `intent.nonce`
against the real onchain event before ever signing a fill (WP-04.9's rule) — a null nonce here
would make every intent fail that check and get silently declined, indistinguishable from "no
work today." Reported to the Nest operator (fix in progress on his end); not blocked on it —
`SqlNestObservationProvider` fetches `nonce` from the raw event table directly, batched by
intentId, same pattern as the fill-check batching. Safe to delete once the view itself is fixed.

## Tests

- [x] `packages/agent/test/sql-nest-observation-provider.test.ts` (22 tests): the cross-chain
      merge, batching (one fills query and one nonce-lookup query per chain regardless of
      candidate count, zero of either when there are no candidates), the nonce workaround itself
      (including a hostile "no nonce found" case, which throws rather than defaulting), truncated
      and degraded responses refused, vault/settlement-health reads, `/ready`-sourced staleness,
      SQL-injection-shaped input refused before ever reaching a query string, failure/recovery.
- [x] `test/entrypoint/config.test.ts`: `SUBGRAPH_URL_{PREFIX}` unset resolves to the committed
      Nest default (and the two chains' defaults are confirmed distinct — an override on one must
      never leak to the other); set, overrides it.
- [x] **Live-verified against the real, running Nests, not only mocks** — the bar this whole
      session holds every deliverable to: `SqlNestObservationProvider` run directly against both
      hosted endpoints correctly discovered a real pending intent and correctly excluded another
      that a fill already existed for; `vaultState`/`settlementHealth` run against the real Nest
      plus a real Sepolia RPC read back correct, real vault figures. Then the full live entrypoint
      (`main.ts`), with **zero** `SUBGRAPH_URL_*` set, booted, logged the two committed Nest URLs
      it defaulted to, discovered that same real pending intent through the entire production
      wiring path, and reported a real decision (`UNVERIFIED`) — not a crash, not an empty world.

## Acceptance gate

Any solver operator — House, an Arcaidia-run demo instance, or an independent one (ETHGlobal
included) — starts `arcaidia-solver` with zero `SUBGRAPH_URL_*` configured and discovers real
pending intents against Arcaidia's shared, unlimited indexer. **Met**, live-verified above, for
both chains. Open: 22.5's healthcheck, so an outage is noticed before a demo solver goes quiet.
