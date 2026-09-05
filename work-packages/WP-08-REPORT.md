# WP-08 report

**Date:** 2026-09-05 · **Status:** built and tested; **deployment outstanding** · **Next:** WP-09.

## 1. Where the gate stands

> Disabling The Graph stops automated discovery and processing. Live Graph data
> materially changes agent decisions.

**Both behaviours are built and tested.** What is not yet done is deploying the
subgraphs, which needs a Subgraph Studio account and an API key — and start
blocks, which do not exist until WP-10 deploys the contracts. Marked ◐ rather
than ✅ for that reason; see §5.

`pnpm test:global` green: **94 domain, 182 agent, 73 settlement, 246 contract
tests run twice, 21 end-to-end.**

## 2. What exists

```
subgraph/
  schema.graphql                    Intent, Fill, Settlement, Vault, ProtocolState
  src/router.ts                     IntentCreated
  src/vault.ts                      FastFilled, deposits, withdrawals, reimbursement, fees, pause
  src/settlement.ts                 both settlement outcomes
  subgraph.<chain>.yaml             generated from packages/domain
packages/agent/src/observation/
  graph-observation-provider.ts     the live provider (17 tests)
  graph-client.ts                   a narrow GraphQL surface
```

New commands: `pnpm subgraph:generate`, `pnpm subgraph:build`, and
`pnpm subgraph:check` — the last now runs inside `test:global`, so a manifest
can never drift from the addresses the rest of the system uses.

## 3. Decisions

**Manifests are generated from the shared configuration.** A subgraph pointed at
the wrong address indexes nothing and reports an empty world, which the solver
reads as "no work" — a silent failure indistinguishable from a quiet day. The
addresses come from `packages/domain` and a staleness check guards them.

**`observedAt` comes from the subgraph, not the local clock.** This is the most
consequential line in the provider. A subgraph is a cache that lags; stamping
observations with `Date.now()` would make one an hour behind look perfectly
fresh and leave the risk engine's staleness guard permanently inert. A test
asserts a lagging subgraph produces a real `OBSERVATION_STALE` rejection.

**Failures throw; they never return an empty world.** Answering "no pending
intents" during an outage reports a quiet day rather than a failure, and the
solver would idle contentedly while work piled up. Halting automation is the
correct response to losing observation.

**The provider does not claim to know the canonical transport's health.** An
indexer answering says nothing about whether Circle is up. That observation
belongs to the settlement worker, which derives it from what it has actually
seen — so the provider reports what it knows and no more.

**Aggregates are maintained incrementally.** `pendingSettlementValue` and
`oldestUnsettledTimestamp` are written on each event rather than summed at query
time, because a query-time sum grows with volume and would quietly slow the
solver exactly as the protocol got busy.

**Fills and settlements stand alone, keyed by `intentId`.** An intent is created
on one chain and filled on the other, so the destination subgraph has no local
Intent to attach to. Fabricating one would invent a record of something that
chain never saw; the join happens in the provider, where the two views meet.

## 4. The two tests that matter most

**Provider parity.** `GraphObservationProvider` and `InMemoryObservationProvider`
produce an *identical* decision from equivalent state. That is the evidence the
adapter boundary held: swapping one for the other cannot change what the solver
does. The entire substitution strategy — one mock replaced per work package —
rests on this being true, and it is now asserted rather than assumed.

**Live Graph state changing a decision.** An aggregate visible *only* through the
subgraph — 50,000 USDC of pending settlement across both chains — turns an
ACCEPT into a `SETTLEMENT_BACKLOG` REJECT. This is the bounty's own requirement
that Graph data be load-bearing, demonstrated as a test rather than a claim.

## 5. Outstanding

**Deployment to Subgraph Studio.** Needs an account and an API key, and start
blocks that do not exist until the contracts are deployed in WP-10. The
manifests, mappings and provider are ready; deploying is a command and a
configuration change.

**Matchstick mapping tests.** The mappings compile to WASM against the real ABIs,
which catches signature and type errors, but their *logic* is not unit-tested.
The aggregate arithmetic is the part worth covering. Deferred rather than
skipped: the same arithmetic is asserted end-to-end through the vault contract
tests, so this is redundancy rather than a gap.

**The Graph P1 decision, still open.** P2 (AI use case) is satisfied by what
exists. P1 needs composing two or more Graph products or building on a
standardized schema — Subgraph MCP is the cheap route, an ERC-4626 Substreams
module the more distinctive one. Worth deciding before WP-11.
