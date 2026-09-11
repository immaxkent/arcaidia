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

**Stack:** `graph-node` + Postgres + IPFS (the reference `graphprotocol/graph-node` Docker Compose
stack), one publicly-reachable host per chain. **Not** a new package in this repo — this is
infrastructure Arcaidia operates, plus a small config change to how solvers find it.

## Split: infra (not built in this repo) vs. code (built here)

Provisioning a VPS and running a server is not something a commit can do. This WP is split
accordingly — 22.1/22.2 are operational and tracked here only as a checklist; 22.3–22.6 are real
code with tests, same as every other WP.

## Sub-tasks

- [ ] **22.1 Provision the two self-hosted nodes.** Arc: the Graph rep's own offer — hand him the
      contract addresses + chain info already compiled (chain `5042002`, the three live
      contracts and their start blocks, from `subgraph/subgraph.arc-testnet.yaml`); he hosts and
      operates it. Sepolia: Arcaidia's own equivalent — deploy the reference `graph-node` +
      Postgres + IPFS compose stack to a VPS, pointed at an `ETHEREUM_SEPOLIA_RPC_URL`, and
      `graph deploy` the already-committed, already-generated
      `subgraph/subgraph.ethereum-sepolia.yaml` to it instead of Studio. Not code; tracked here so
      the gate below has something to point at.
- [ ] **22.2 Public reachability + minimal hardening, on both nodes.** HTTPS (matches the
      outbound-only-HTTPS convention already used everywhere else — WP-17.2's telemetry client, the
      settlement adapter), because solvers connect from arbitrary third-party machines, not just
      Arcaidia's own. Firewall each node's admin/deploy port to Arcaidia-only IPs; leave the
      GraphQL query port open with no auth — it's read-only and reveals nothing a public subgraph
      query couldn't already answer, the same reasoning `quote-server.ts` already documents for
      `POST /quote`'s open CORS.
- [ ] **22.3 Committed default subgraph URLs, override-with-fallback — the actual code fix.**
      `packages/domain/src/config/chains.ts` gains a committed `subgraphUrl` per chain (Arcaidia's
      hosted endpoints from 22.1), read by `packages/agent/src/entrypoint/config.ts` with
      `SUBGRAPH_URL_{PREFIX}` as an optional override — the exact shape WP-17.1 already built for
      `{PREFIX}_LIQUIDITY_VAULT`: unset means "use Arcaidia's hosted, uncapped endpoint," present
      overrides it for an operator who wants their own subgraph, malformed still fails loudly.
      Today `SUBGRAPH_URL_{PREFIX}` is `requireUrl` — **required**, no fallback — so this sub-task
      is what actually removes the "you must already have a subgraph" barrier to running a solver
      at all, not just a config nicety.
- [ ] **22.4 `.env.example` and the reference-runtime docs reflect the new default.** Delete the
      implication that an operator needs their own Graph account: state plainly that
      `SUBGRAPH_URL_*` is optional and, unset, points at Arcaidia's own uncapped endpoints; keep it
      settable for anyone who wants to self-host or use their own Studio/Gateway key instead.
- [ ] **22.5 A basic external healthcheck, not a dashboard.** One scheduled check per node:
      query `_meta { block { timestamp } }` and alert if the indexing head is stale beyond a
      threshold, or the endpoint is unreachable. The point is that Arcaidia notices an outage
      before a demo solver silently halts (per WP-08's own rule: the provider throws rather than
      reporting an empty world — which means "the solver stopped" is the *first* signal today,
      with nobody watching for it upstream of that).
- [ ] **22.6 WP-17's onboarding docs get one sentence added.** An independent operator (ETHGlobal
      included) following the Docker Compose reference runtime should see, explicitly: no Graph
      account is required to run this; `SUBGRAPH_URL_*` only needs setting if you want to point at
      your own indexer instead of Arcaidia's.

## Tests

- [ ] Config-layer proof, mirroring `test/entrypoint/config.test.ts`'s existing pattern for
      17.1: `SUBGRAPH_URL_ETHEREUM_SEPOLIA` unset resolves to the committed default; set,
      overrides it; malformed-but-present still fails loudly via `requireUrl` rather than silently
      falling back.
- [ ] A live, network-touching smoke test — outside `test:global`, same category as the existing
      `test:chains` live-network script — that runs `GraphObservationProvider` against the real
      hosted endpoint once 22.1 exists, and confirms it returns a real vault state, not just that
      the URL resolves.

## Acceptance gate

Three solvers running concurrently against Arc testnet — the House Solver and two Arcaidia-run
demo instances — with zero `SUBGRAPH_URL_ARC_TESTNET` configured on any of them, complete the
demo window with no query-cap error from any instance. A fourth, independently-run solver (not
Arcaidia's) started the same way, with the same zero configuration, discovers and fills an intent
against the same shared endpoint.
